/**
 * Test Selection Agent — Sprint 4
 *
 * Input:  {features, affected_modules, risks, dependencies, time_budget_minutes?}
 * Output: {selected_tests[], coverage_estimate, excluded_count, total_duration_ms}
 *
 * ROI principal: de 75 specs existentes, elegir los que importan para este cambio.
 *
 * Scoring por spec:
 *   Base (por suite)  + Module relevance + Risk relevance - Flakiness penalty
 *
 * Fuentes de evidencia (en orden de confianza):
 *   1. risk_map.yaml [tests] — declaración explícita por módulo
 *   2. behavior.json [covered_by] — AC → spec mapping
 *   3. Spec name heuristics — nombre del archivo contiene el módulo
 *   4. Qdrant test_corpus — búsqueda semántica (si indexado)
 *
 * Uso CLI: npx ts-node src/agents/test-selection-agent.ts '<TestSelectionInput JSON>'
 */

import * as fs from "fs"
import * as path from "path"
import * as yaml from "js-yaml"
import { QdrantClient } from "@qdrant/js-client-rest"
import { Client as PgClient } from "pg"
import * as dotenv from "dotenv"

import type { TestSelectionInput, TestSelectionOutput, SelectedTest, Risk } from "./types"
import { startAgentTrace } from "../observability/tracer"

dotenv.config()

const ROOT = path.join(__dirname, "..", "..")
const TESTS_DIR = path.join(ROOT, "tests")
const RISK_MAP_PATH = path.join(ROOT, "risk_map.yaml")
const MODULES_DIR = path.join(ROOT, "qa-knowledge", "modules")
const FLAKY_REGISTRY_PATH = path.join(ROOT, "state", "flaky_registry.json")

const qdrant = new QdrantClient({ host: "localhost", port: 6333 })

// ─── Tipos internos ───────────────────────────────────────────────────────────

type Suite = "contract" | "smoke" | "integration" | "e2e" | "visual" | "a11y" | "performance"

interface SpecMeta {
  spec_file: string       // path relativo a ROOT
  suite: Suite
  test_names: string[]    // títulos extraídos del archivo
  modules_direct: string[] // módulos con evidencia directa (risk_map o covered_by)
  modules_heuristic: string[] // módulos inferidos por nombre de archivo
}

interface FlakyEntry {
  spec_file: string
  flaky_count_30d: number
  failure_rate: number
  classification: string
}

// ─── Configuración de scoring ─────────────────────────────────────────────────

const SUITE_BASE_SCORE: Record<Suite, number> = {
  contract:    45,  // siempre relevante si hay cambio de API
  smoke:       40,  // siempre corre
  integration: 30,
  e2e:         25,
  visual:      15,
  a11y:        10,
  performance: 10,
}

// ms estimados por spec file (no por test individual)
const SUITE_DURATION_MS: Record<Suite, number> = {
  contract:    25_000,
  smoke:       20_000,
  integration: 90_000,
  e2e:        180_000,
  visual:      60_000,
  a11y:       120_000,
  performance: 300_000,
}

// Suites que siempre van sin importar el cambio
const ALWAYS_RUN: Suite[] = ["contract", "smoke"]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getSuite(specFile: string): Suite {
  if (specFile.includes("/contract/")) return "contract"
  if (specFile.includes("/smoke/")) return "smoke"
  if (specFile.includes("/integration/")) return "integration"
  if (specFile.includes("/e2e/")) return "e2e"
  if (specFile.includes("/visual/")) return "visual"
  if (specFile.includes("/a11y/")) return "a11y"
  if (specFile.includes("/performance/")) return "performance"
  return "integration"
}

function collectSpecs(): string[] {
  const results: string[] = []
  function walk(dir: string) {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith(".spec.ts")) results.push(full)
    }
  }
  walk(TESTS_DIR)
  return results
}

function extractTestNames(content: string): string[] {
  const names: string[] = []
  const re = /(?:test|it|describe)\s*\(\s*['"`]([^'"`]+)['"`]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) names.push(m[1])
  return names
}

// Construye índice módulo → spec_files desde risk_map.yaml campo [tests]
function buildRiskMapIndex(riskMap: { modules: Record<string, { tests?: string[] }> }): Map<string, Set<string>> {
  const idx = new Map<string, Set<string>>()
  for (const [mod, data] of Object.entries(riskMap.modules)) {
    for (const specFile of data.tests ?? []) {
      const normalized = specFile.replace(/\\/g, "/")
      if (!idx.has(mod)) idx.set(mod, new Set())
      idx.get(mod)!.add(normalized)
    }
  }
  return idx
}

// Construye índice módulo → spec_files desde behavior.json [covered_by]
function buildCoveredByIndex(): Map<string, Set<string>> {
  const idx = new Map<string, Set<string>>()
  if (!fs.existsSync(MODULES_DIR)) return idx

  for (const modName of fs.readdirSync(MODULES_DIR)) {
    const bPath = path.join(MODULES_DIR, modName, "behavior.json")
    if (!fs.existsSync(bPath)) continue
    try {
      const behavior = JSON.parse(fs.readFileSync(bPath, "utf8")) as {
        acceptance_criteria?: Array<{ covered_by?: string[] }>
      }
      for (const ac of behavior.acceptance_criteria ?? []) {
        for (const specFile of ac.covered_by ?? []) {
          const normalized = specFile.replace(/\\/g, "/")
          if (!idx.has(modName)) idx.set(modName, new Set())
          idx.get(modName)!.add(normalized)
        }
      }
    } catch { /* ignore parse errors */ }
  }
  return idx
}

// Infiere módulos de un spec por su nombre de archivo
function inferModulesFromName(specFile: string, allModules: string[]): string[] {
  const name = path.basename(specFile, ".spec.ts").toLowerCase()
  return allModules.filter(mod => {
    const modKey = mod.toLowerCase().replace(/-/g, "")
    const nameKey = name.replace(/-/g, "")
    return nameKey.includes(modKey) || modKey.includes(nameKey.split("-")[0])
  })
}

function loadFlakyRegistry(): Map<string, FlakyEntry> {
  const idx = new Map<string, FlakyEntry>()
  if (!fs.existsSync(FLAKY_REGISTRY_PATH)) return idx
  try {
    const reg = JSON.parse(fs.readFileSync(FLAKY_REGISTRY_PATH, "utf8")) as {
      tests: FlakyEntry[]
    }
    for (const entry of reg.tests ?? []) {
      idx.set(entry.spec_file, entry)
    }
  } catch { /* ignore */ }
  return idx
}

// Mapeo módulo → riesgo IDs (reflejo del Risk Agent para calcular covers_risks)
const MODULE_TO_RISK_IDS: Record<string, string[]> = {
  "events":         ["R1"],
  "ads-manager":    ["R2", "R3"],
  "ads-ima":        ["R3"],
  "ads-dai":        ["R3"],
  "ads-sgai":       ["R3"],
  "state":          ["R4"],
  "playback-core":  ["R5"],
  "hls":            ["R5"],
  "dash":           ["R5"],
  "youbora":        ["R6"],
  "controls-api":   ["R7"],
  "drm":            ["R10"],
  "api-bootstrap":  ["R1"],
  "constants":      ["R1"],
  "platform-config":["R9"],
}

function getRiskIdsForModules(modules: string[], risks: Risk[]): string[] {
  const relevantRiskIds = new Set<string>()
  for (const mod of modules) {
    for (const rId of MODULE_TO_RISK_IDS[mod] ?? []) {
      if (risks.some(r => r.id === rId || r.related_modules.includes(mod))) {
        relevantRiskIds.add(rId)
      }
    }
    // También incluir risks que mencionan este módulo
    for (const risk of risks) {
      if (risk.related_modules.includes(mod)) relevantRiskIds.add(risk.id)
    }
  }
  return [...relevantRiskIds]
}

function getACsForSpec(specFile: string, coveredByIdx: Map<string, Set<string>>): string[] {
  const acs: string[] = []
  // Leer behavior.json de todos los módulos y ver qué ACs mencionan este spec
  if (!fs.existsSync(MODULES_DIR)) return acs
  for (const modName of fs.readdirSync(MODULES_DIR)) {
    const bPath = path.join(MODULES_DIR, modName, "behavior.json")
    if (!fs.existsSync(bPath)) continue
    try {
      const behavior = JSON.parse(fs.readFileSync(bPath, "utf8")) as {
        acceptance_criteria?: Array<{ id: string; covered_by?: string[] }>
      }
      for (const ac of behavior.acceptance_criteria ?? []) {
        if (ac.covered_by?.some(cb => specFile.includes(cb) || cb.includes(path.basename(specFile)))) {
          acs.push(ac.id)
        }
      }
    } catch { /* ignore */ }
  }
  return acs
}

async function semanticSearch(query: string, modules: string[]): Promise<string[]> {
  try {
    const collections = await qdrant.getCollections()
    if (!collections.collections.some(c => c.name === "test_corpus")) return []

    const results = await qdrant.search("test_corpus", {
      vector: new Array(384).fill(0),  // placeholder — reemplazar con embed real
      limit: 10,
      filter: {
        should: modules.map(m => ({ key: "module", match: { value: m } })),
      },
      with_payload: true,
    })
    return results.map(r => String(r.payload?.["spec_file"] ?? "")).filter(Boolean)
  } catch {
    return []
  }
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

function scoreSpec(
  meta: SpecMeta,
  affectedModules: string[],
  risks: Risk[],
  flakyMap: Map<string, FlakyEntry>,
  semanticHits: Set<string>
): number {
  let score = SUITE_BASE_SCORE[meta.suite]

  // Bonus por módulo con evidencia directa
  const directHit = meta.modules_direct.some(m => affectedModules.includes(m))
  if (directHit) score += 40

  // Bonus por módulo inferido por nombre
  const heuristicHit = meta.modules_heuristic.some(m => affectedModules.includes(m))
  if (heuristicHit && !directHit) score += 20

  // Bonus por riesgo crítico cubierto
  const coversRiskIds = getRiskIdsForModules(
    [...meta.modules_direct, ...meta.modules_heuristic].filter(m => affectedModules.includes(m)),
    risks
  )
  const criticalRisks = risks.filter(r => r.severity === "critical" && coversRiskIds.includes(r.id))
  const highRisks = risks.filter(r => r.severity === "high" && coversRiskIds.includes(r.id))
  score += criticalRisks.length * 30
  score += highRisks.length * 15

  // Bonus semántico
  if (semanticHits.has(meta.spec_file)) score += 10

  // Penalización por flakiness
  const flaky = flakyMap.get(meta.spec_file)
  if (flaky) {
    if (flaky.classification === "CONFIRMED_FAILURE") score -= 70
    else if (flaky.flaky_count_30d > 5) score -= 50
    else if (flaky.flaky_count_30d > 2) score -= 30
    if (flaky.failure_rate > 0.5) score -= 40
    else if (flaky.failure_rate > 0.2) score -= 15
  }

  return score
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function runTestSelectionAgent(input: TestSelectionInput): Promise<TestSelectionOutput> {
  const span = startAgentTrace("test-selection-agent", input)

  try {
    const riskMap = yaml.load(fs.readFileSync(RISK_MAP_PATH, "utf8")) as {
      modules: Record<string, { tests?: string[]; risk_label?: string }>
    }
    const allModules = Object.keys(riskMap.modules)

    // Índices de evidencia
    const riskMapIdx = buildRiskMapIndex(riskMap)
    const coveredByIdx = buildCoveredByIndex()
    const flakyMap = loadFlakyRegistry()

    // Búsqueda semántica (graceful)
    const semanticSpecFiles = await semanticSearch(
      input.features.join(" ") + " " + input.affected_modules.join(" "),
      input.affected_modules
    )
    const semanticHits = new Set(semanticSpecFiles)

    // Construir metadata de todos los specs
    const specFiles = collectSpecs()
    const specMetas: SpecMeta[] = specFiles.map(full => {
      const relative = path.relative(ROOT, full).replace(/\\/g, "/")
      const content = fs.readFileSync(full, "utf8")

      // Módulos con evidencia directa
      const modulesDirect: string[] = []
      for (const mod of input.affected_modules) {
        if (riskMapIdx.get(mod)?.has(relative)) modulesDirect.push(mod)
        if (coveredByIdx.get(mod)?.has(relative)) {
          if (!modulesDirect.includes(mod)) modulesDirect.push(mod)
        }
      }

      return {
        spec_file: relative,
        suite: getSuite(relative),
        test_names: extractTestNames(content),
        modules_direct: modulesDirect,
        modules_heuristic: inferModulesFromName(relative, allModules)
          .filter(m => input.affected_modules.includes(m)),
      }
    })

    // Calcular puntuaciones
    const scored = specMetas.map(meta => ({
      meta,
      score: scoreSpec(meta, input.affected_modules, input.risks, flakyMap, semanticHits),
      coversRisks: getRiskIdsForModules(
        [...meta.modules_direct, ...meta.modules_heuristic],
        input.risks
      ),
      coversACs: getACsForSpec(meta.spec_file, coveredByIdx),
      durationMs: SUITE_DURATION_MS[meta.suite],
    }))

    // Ordenar: ALWAYS_RUN primero, luego por score descendente
    scored.sort((a, b) => {
      const aAlways = ALWAYS_RUN.includes(a.meta.suite)
      const bAlways = ALWAYS_RUN.includes(b.meta.suite)
      if (aAlways && !bAlways) return -1
      if (!aAlways && bAlways) return 1
      return b.score - a.score
    })

    // Aplicar budget de tiempo
    const budgetMs = (input.time_budget_minutes ?? 60) * 60_000
    let accumulatedMs = 0
    const selected: SelectedTest[] = []
    const excluded: SpecMeta[] = []

    for (const item of scored) {
      // Los ALWAYS_RUN entran siempre (ignorar budget)
      const isAlways = ALWAYS_RUN.includes(item.meta.suite)
      if (isAlways || accumulatedMs + item.durationMs <= budgetMs) {
        if (item.score > 0 || isAlways) {  // score > 0 = relevante
          selected.push({
            spec_file: item.meta.spec_file,
            test_name: item.meta.test_names.slice(0, 3).join(" | ") || "(ver spec)",
            priority: Math.min(100, Math.max(1, item.score)),
            reason: buildReason(item.meta, input.affected_modules, item.score),
            covers_risks: item.coversRisks,
            covers_acs: item.coversACs,
            estimated_duration_ms: item.durationMs,
          })
          if (!isAlways) accumulatedMs += item.durationMs
        } else {
          excluded.push(item.meta)
        }
      } else {
        excluded.push(item.meta)
      }
    }

    // coverage_estimate: % de risks cubiertos por tests seleccionados
    const totalRisks = input.risks.length
    const coveredRiskIds = new Set(selected.flatMap(t => t.covers_risks))
    const coverageEstimate = totalRisks > 0
      ? Math.round((coveredRiskIds.size / totalRisks) * 100)
      : 100

    const output: TestSelectionOutput = {
      selected_tests: selected,
      coverage_estimate: coverageEstimate,
      excluded_count: excluded.length,
      total_duration_ms: accumulatedMs,
    }

    span.end(output, {
      selected: selected.length,
      excluded: excluded.length,
      coverage_estimate: coverageEstimate,
    })

    return output

  } catch (err) {
    span.error(err as Error)
    throw err
  }
}

function buildReason(meta: SpecMeta, affectedModules: string[], score: number): string {
  const reasons: string[] = []
  if (ALWAYS_RUN.includes(meta.suite)) reasons.push(`suite ${meta.suite} siempre corre`)
  if (meta.modules_direct.length > 0) reasons.push(`cubre módulos: ${meta.modules_direct.join(", ")} (evidencia directa)`)
  if (meta.modules_heuristic.length > 0 && meta.modules_direct.length === 0) {
    reasons.push(`módulos inferidos: ${meta.modules_heuristic.join(", ")}`)
  }
  if (reasons.length === 0) reasons.push(`score ${score}`)
  return reasons.join("; ")
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const raw = process.argv[2]
  if (!raw) {
    console.error("Uso: npx ts-node src/agents/test-selection-agent.ts '<TestSelectionInput JSON>'")
    process.exit(1)
  }

  const input = JSON.parse(raw) as TestSelectionInput

  runTestSelectionAgent(input)
    .then(output => {
      const total = Math.round(output.total_duration_ms / 1000)
      console.error(`\n✓ Seleccionados: ${output.selected_tests.length} specs | Excluidos: ${output.excluded_count} | Cobertura de riesgos: ${output.coverage_estimate}% | ~${total}s`)
      console.log(JSON.stringify(output, null, 2))
    })
    .catch(err => {
      console.error(JSON.stringify({ error: err.message }))
      process.exit(1)
    })
}
