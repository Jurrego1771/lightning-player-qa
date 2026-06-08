/**
 * Change Analysis Agent — Sprint 2
 *
 * Input:  {ref, type}  (PR | commit | branch | release)
 * Output: {features[], platforms[], services[], affected_modules[], ...}
 *
 * Flujo:
 *   1. prepare-diff.ts → diff-input.json (mapeo archivo → módulo)
 *   2. Mapear módulos → features/platforms/services
 *   3. Qdrant: búsqueda semántica de cambios similares (si disponible)
 *   4. Claude: clasificar platforms + services desde diff context
 *
 * Uso CLI: npx ts-node src/agents/change-analysis-agent.ts '{"ref":"87","type":"pr"}'
 */

import * as fs from "fs"
import * as path from "path"
import * as yaml from "js-yaml"
import { execSync } from "child_process"
import * as dotenv from "dotenv"

import type { ChangeAnalysisInput, ChangeAnalysisOutput, SemanticSignals, SimilarChange } from "./types"
import { startAgentTrace } from "../observability/tracer"
import { callClaudeJson } from "../llm/claude-cli"

dotenv.config()

const ROOT = path.join(__dirname, "..", "..")
const DIFF_INPUT_PATH = path.join(ROOT, "tmp", "pipeline", "diff-input.json")
const RISK_MAP_PATH = path.join(ROOT, "risk_map.yaml")

// Módulos → features de negocio. Los módulos internos ya SON features aquí.
// Si en el futuro hay un feature registry, se mapea aquí.
const FEATURE_ALIASES: Record<string, string> = {
  "ads-ima":        "google-ima-ads",
  "ads-dai":        "dynamic-ad-insertion",
  "ads-sgai":       "server-guided-ai",
  "ads-adswizz":    "adswizz-ads",
  "ads-manager":    "ad-management",
  "playback-core":  "playback",
  "hls":            "hls-playback",
  "dash":           "dash-playback",
  "drm":            "drm-protection",
  "quality-selector": "quality-selection",
  "youbora":        "npaw-analytics",
}

// Señales de plataforma en rutas de archivos o código
const PLATFORM_SIGNALS: Array<{ platforms: string[]; patterns: RegExp[] }> = [
  { platforms: ["ios"], patterns: [/fairplay/i, /\.m3u8.*ios/i, /safari/i, /webkit/i] },
  { platforms: ["android"], patterns: [/widevine/i, /android/i] },
  { platforms: ["tv"], patterns: [/smarttv|smart-tv|tizen|webos|tv/i] },
  { platforms: ["web"], patterns: [/chrome|firefox|browser|web/i] },
]

// Módulos puramente internos — no son features de negocio, no aparecen en `features[]`
const INTERNAL_MODULES = new Set([
  "constants", "dependency", "state", "events", "api-bootstrap",
  "platform-config", "plugins", "context",
])

// Servicios externos detectables desde módulos (sin duplicados)
const MODULE_TO_SERVICES: Record<string, string[]> = {
  "ads-ima":      ["google-ima"],
  "ads-dai":      ["google-dai"],
  "ads-sgai":     ["google-sgai"],
  "ads-adswizz":  ["adswizz"],
  "drm":          ["widevine", "fairplay", "playready"],
  "hls":          ["hls.js"],
  "youbora":      ["npaw"],
  "chromecast":   ["chromecast-sdk"],
  "analytics-comscore": ["comscore"],
  "ads-manager":  ["google-ima", "google-dai", "google-sgai"],
}

interface PrMetadata {
  title: string
  body: string
  head_branch: string
  base_branch: string
  labels: string[]
  author: string
  reviewer_comments?: string[]
}

interface DiffInput {
  input_ref: string
  input_type: string
  cross_cutting_risk: boolean
  cross_cutting_reasons: string[]
  modules_affected: string[]
  modules_by_criticality: Record<string, string[]>
  change_type?: string
  pr_metadata: PrMetadata | null
  files: Array<{
    path: string
    module: string
    criticality: string
    inferred: boolean
    patch: string
    symbols_changed: string[]
    events_touched: string[]
  }>
}

function loadDiffInput(): DiffInput {
  if (!fs.existsSync(DIFF_INPUT_PATH)) {
    throw new Error(`diff-input.json no encontrado. Ejecutar primero: npx ts-node scripts/prepare-diff.ts ${process.argv[2] ?? "<ref>"}`)
  }
  return JSON.parse(fs.readFileSync(DIFF_INPUT_PATH, "utf8"))
}

function runPrepareDiff(ref: string): void {
  console.error(`[change-analysis] Ejecutando prepare-diff.ts para ${ref}...`)
  execSync(`npx ts-node "${path.join(ROOT, "scripts", "prepare-diff.ts")}" "${ref}"`, {
    stdio: ["ignore", "pipe", "pipe"],
    cwd: ROOT,
  })
}

function mapModulesToFeatures(modules: string[]): string[] {
  return [...new Set(
    modules
      .filter(m => !INTERNAL_MODULES.has(m))   // excluir infraestructura interna
      .map(m => FEATURE_ALIASES[m] ?? m)
  )]
}

function inferServicesFromModules(modules: string[]): string[] {
  const services = new Set<string>()
  for (const mod of modules) {
    for (const svc of MODULE_TO_SERVICES[mod] ?? []) {
      services.add(svc)
    }
  }
  return [...services]
}

function inferPlatformsFromDiff(diff: DiffInput): string[] {
  const platforms = new Set<string>()
  const allText = diff.files.map(f => f.path + " " + f.patch).join(" ").toLowerCase()

  for (const { platforms: ps, patterns } of PLATFORM_SIGNALS) {
    if (patterns.some(p => p.test(allText))) {
      for (const p of ps) platforms.add(p)
    }
  }

  // DRM → tanto widevine (android/web) como fairplay (ios)
  if (diff.modules_affected.includes("drm")) {
    platforms.add("web")
    platforms.add("android")
    platforms.add("ios")
  }

  // Default: web siempre aplica para player
  platforms.add("web")

  return [...platforms]
}

// Conventional commit + branch name patterns → change_type
const CHANGE_TYPE_RULES: Array<{ type: string; patterns: RegExp[] }> = [
  { type: "docs",        patterns: [/^docs[:(]/i, /\b(docs?|readme|changelog|comment)\b/i] },
  { type: "test-update", patterns: [/^test[:(]/i, /\b(test|spec|fixture|qa)\b/i] },
  { type: "bug-fix",     patterns: [/^fix[:(]/i, /\b(fix|bug|hotfix|patch|revert|regression)\b/i] },
  { type: "feature",     patterns: [/^feat[:(]/i, /\b(feat|feature|add|new|implement|introduce)\b/i] },
  { type: "refactor",    patterns: [/^refactor[:(]/i, /\b(refactor|cleanup|clean.?up|rename|move)\b/i] },
  { type: "performance", patterns: [/^perf[:(]/i, /\b(perf|optim|improve.{0,20}perf|speed)\b/i] },
  { type: "dependency",  patterns: [/^chore[:(]/i, /\b(chore|deps?|bump|upgrade|downgrade)\b/i] },
]

function detectChangeType(diff: DiffInput): string {
  const sources = [
    diff.pr_metadata?.title ?? "",
    diff.pr_metadata?.head_branch ?? "",
    diff.pr_metadata?.body?.slice(0, 200) ?? "",
    diff.change_type ?? "",
  ].join(" ").toLowerCase()

  if (!sources.trim()) return "feature"

  for (const { type, patterns } of CHANGE_TYPE_RULES) {
    if (patterns.some(p => p.test(sources))) return type
  }
  return "feature"
}

function buildChangeSummary(diff: DiffInput, features: string[]): string {
  const meta = diff.pr_metadata
  if (meta?.title) return meta.title.slice(0, 150)
  if (features.length > 0) return `Cambio en: ${features.slice(0, 3).join(", ")}`
  return `Cambio en módulos: ${diff.modules_affected.slice(0, 3).join(", ")}`
}

function calcRiskSignal(diff: DiffInput): "high" | "medium" | "low" {
  const criticalCount = diff.modules_by_criticality?.critical?.length ?? 0
  const highCount = diff.modules_by_criticality?.high?.length ?? 0
  const criticalLabel = diff.pr_metadata?.labels?.some(l =>
    /critical|urgent|hotfix|blocker/i.test(l)
  ) ?? false

  // Leer risk_label de los módulos afectados desde risk_map.yaml
  let hasHighRiskModule = false
  try {
    const riskMapRaw = fs.readFileSync(RISK_MAP_PATH, "utf8")
    const riskMap = yaml.load(riskMapRaw) as { modules: Record<string, { risk_label: string }> }
    hasHighRiskModule = diff.modules_affected.some(m =>
      ["critical", "high"].includes(riskMap.modules[m]?.risk_label ?? "")
    )
  } catch { /* continúa */ }

  if (diff.cross_cutting_risk || criticalCount > 0 || criticalLabel) return "high"
  if (highCount > 0 || hasHighRiskModule) return "high"
  return "low"
}


// ─── Phase 2: LLM gap-fill ────────────────────────────────────────────────────

interface LLMTrigger {
  needed: boolean
  reasons: string[]
}

function shouldTriggerLLM(
  diff: DiffInput,
  changeType: string
): LLMTrigger {
  const reasons: string[] = []
  const unknownFiles = diff.files.filter(f => f.inferred === true)
  if (unknownFiles.length > 0) reasons.push(`${unknownFiles.length} archivos sin módulo en risk_map`)
  if ((diff.pr_metadata?.body?.length ?? 0) > 100) reasons.push("PR body sustancial")
  if ((diff.pr_metadata?.reviewer_comments?.length ?? 0) > 0) reasons.push(`${diff.pr_metadata!.reviewer_comments!.length} comentarios de reviewer`)
  return { needed: reasons.length > 0, reasons }
}

interface LLMGapResult {
  unknown_classified: Array<{ path: string; module: string; reasoning: string }>
  change_type_confirmed: string | null
  reviewer_signals: string[]
}

async function classifyGapsWithLLM(
  unknownFiles: DiffInput["files"],
  prBody: string,
  reviewerComments: string[],
  changeType: string,
  validModules: string[]
): Promise<LLMGapResult> {
  const unknownSection = unknownFiles.length > 0
    ? unknownFiles.map(f => {
        const patchPreview = f.patch.split('\n').slice(0, 20).join('\n')
        return `- ${f.path}\n${patchPreview}`
      }).join('\n\n')
    : "(ninguno)"

  const prompt = `You are a QA classification agent for a video player repository.

VALID MODULES (from risk_map.yaml):
${validModules.join(", ")}

UNKNOWN FILES (not matched to any module):
${unknownSection}

PR DESCRIPTION:
${prBody.slice(0, 300) || "(vacío)"}

REVIEWER COMMENTS:
${reviewerComments.slice(0, 5).join('\n') || "(ninguno)"}

CURRENT CHANGE TYPE DETECTED: ${changeType}

Respond with JSON only (no markdown, no explanation):
{
  "unknown_classified": [{"path": "...", "module": "...", "reasoning": "one sentence"}],
  "change_type_confirmed": "feature|bug-fix|refactor|docs|test-update|performance|dependency|null",
  "reviewer_signals": ["risk phrase 1"]
}

Rules:
- module must be one of VALID MODULES or "unknown" if truly unclassifiable
- change_type_confirmed: use null to keep current detection; only override if clearly wrong
- reviewer_signals: max 5 short phrases, only actual risk indicators from reviewer comments`

  return callClaudeJson<LLMGapResult>(prompt, { model: "haiku", timeoutMs: 30_000 })
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function runChangeAnalysis(input: ChangeAnalysisInput): Promise<ChangeAnalysisOutput> {
  const span = startAgentTrace("change-analysis-agent", input)

  try {
    // 1. Obtener diff (ejecutar prepare-diff.ts si no existe o ref cambió)
    let diff: DiffInput
    try {
      diff = loadDiffInput()
      // Si la ref no coincide, re-ejecutar
      if (diff.input_ref !== input.ref) {
        runPrepareDiff(input.ref)
        diff = loadDiffInput()
      }
    } catch {
      runPrepareDiff(input.ref)
      diff = loadDiffInput()
    }

    // 2. Phase 1: determinista
    const platforms = inferPlatformsFromDiff(diff)
    let change_type = detectChangeType(diff)
    let modules_affected = [...diff.modules_affected]

    // 3. Phase 2: LLM gap-fill (conditional, Haiku only)
    let llm_used = false
    let llm_model: string | undefined
    let llm_trigger_reasons: string[] | undefined
    let semantic_signals: SemanticSignals | undefined

    const trigger = shouldTriggerLLM(diff, change_type)
    if (trigger.needed) {
      try {
        const riskMapRaw = fs.readFileSync(RISK_MAP_PATH, "utf8")
        const riskMap = yaml.load(riskMapRaw) as { modules: Record<string, unknown> }
        const validModules = Object.keys(riskMap.modules)

        const unknownFiles = diff.files.filter(f => f.inferred === true)
        const gapResult = await classifyGapsWithLLM(
          unknownFiles,
          diff.pr_metadata?.body ?? "",
          diff.pr_metadata?.reviewer_comments ?? [],
          change_type,
          validModules
        )

        // Merge: reclasificar archivos inferred con resultado del LLM
        for (const classified of gapResult.unknown_classified) {
          if (classified.module !== "unknown" && validModules.includes(classified.module)) {
            const file = diff.files.find(f => f.path === classified.path)
            if (file) file.inferred = false
            if (!modules_affected.includes(classified.module)) {
              modules_affected.push(classified.module)
            }
          }
        }

        // Override change_type solo si LLM es explícito
        if (gapResult.change_type_confirmed && gapResult.change_type_confirmed !== "null") {
          change_type = gapResult.change_type_confirmed
        }

        llm_used = true
        llm_model = "claude-haiku-4-5-20251001"
        llm_trigger_reasons = trigger.reasons
        semantic_signals = {
          reviewer_signals: gapResult.reviewer_signals,
          unknown_files_classified: gapResult.unknown_classified.filter(c => c.module !== "unknown" && validModules.includes(c.module)).length,
          change_type_overridden: change_type !== detectChangeType(diff),
        }
      } catch (llmErr) {
        console.error(`[change-analysis] LLM gap-fill falló: ${(llmErr as Error).message} — usando resultado determinista`)
      }
    }

    const features = mapModulesToFeatures(modules_affected)
    const services = inferServicesFromModules(modules_affected)
    const change_summary = buildChangeSummary(diff, features)

    const output: ChangeAnalysisOutput = {
      ref: input.ref,
      ref_type: input.type,
      features,
      platforms,
      services,
      affected_modules: modules_affected,
      change_summary,
      risk_signal: calcRiskSignal(diff),
      change_type,
      cross_cutting: diff.cross_cutting_risk,
      similar_past_changes: [],
      pr_metadata: diff.pr_metadata ?? undefined,
      llm_used,
      llm_model,
      llm_trigger_reasons,
      semantic_signals,
    }

    span.end(output, { modules_count: modules_affected.length, llm_used })
    return output

  } catch (err) {
    span.error(err as Error)
    throw err
  }
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const raw = process.argv[2]
  if (!raw) {
    console.error('Uso: npx ts-node src/agents/change-analysis-agent.ts \'{"ref":"87","type":"pr"}\'')
    process.exit(1)
  }

  let input: ChangeAnalysisInput
  try {
    input = JSON.parse(raw)
  } catch {
    // Formato corto: npx ts-node ... "87 pr"
    const [ref, type] = raw.split(" ")
    input = { ref, type: (type ?? "pr") as ChangeAnalysisInput["type"] }
  }

  runChangeAnalysis(input)
    .then(output => {
      console.log(JSON.stringify(output, null, 2))
    })
    .catch(err => {
      console.error(JSON.stringify({ error: err.message }))
      process.exit(1)
    })
}
