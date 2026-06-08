/**
 * knowledge-drift.ts
 *
 * Detecta divergencia entre player source y knowledge base.
 *
 * Un "drift" ocurre cuando:
 *   A. Un evento del player existe en código pero NO en behavior.json
 *   B. Un método público existe en código pero NO hay AC que lo cubra
 *   C. behavior.json menciona un evento/método que ya no existe en código fuente
 *
 * Uso:
 *   npx ts-node src/memory/knowledge-drift.ts [--module <id>] [--fix-hints]
 *
 * Output JSON: {drifts[], stale_acs[], missing_events[], missing_methods[]}
 */

import * as fs from "fs"
import * as path from "path"
import * as yaml from "js-yaml"
import * as dotenv from "dotenv"

dotenv.config()

const ROOT          = path.join(__dirname, "..", "..")
const MODULES_DIR   = path.join(ROOT, "qa-knowledge", "modules")
const RISK_MAP_PATH = path.join(ROOT, "risk_map.yaml")
const PLAYER_REPO   = process.env.PLAYER_LOCAL_REPO ?? ""

const MODULE_FILTER = (() => {
  const idx = process.argv.indexOf("--module")
  return idx !== -1 ? process.argv[idx + 1] : null
})()
const FIX_HINTS = process.argv.includes("--fix-hints")

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type DriftType =
  | "event_in_code_not_in_ac"      // evento en player, sin AC que lo cubra
  | "method_in_code_not_in_ac"     // método público sin AC
  | "ac_references_missing_event"  // AC menciona evento que ya no existe
  | "covered_by_points_to_missing" // covered_by referencia spec inexistente

export interface DriftItem {
  module_id: string
  drift_type: DriftType
  symbol: string       // nombre del evento/método/AC
  detail: string
  severity: "critical" | "high" | "medium" | "low"
  fix_hint?: string
}

export interface DriftReport {
  analyzed_at: string
  player_repo: string
  modules_checked: number
  total_drifts: number
  drifts: DriftItem[]
  stale_covered_by: Array<{ ac_id: string; module_id: string; bad_path: string }>
}

interface BehaviorJson {
  module?: string
  acceptance_criteria?: Array<{
    id: string
    scenario: string
    covered_by?: string[]
    given?: string
    when?: string
    then?: string
  }>
  events?: Array<{ name: string; when: string }>
}

interface RiskMapModule {
  files?: string[]
}
interface RiskMap { modules: Record<string, RiskMapModule> }

// ─── Extracción de símbolos del código fuente del player ─────────────────────

const EVENT_RE     = /emit\s*\(\s*['"`]([A-Za-z][A-Za-z0-9_]+)['"`]/g
const EXPORTED_RE  = /export\s+(?:function|const|class|async function)\s+([A-Za-z][A-Za-z0-9_]+)/g
const PUBLIC_RE    = /(?:^|\s)public\s+(?:async\s+)?([A-Za-z][A-Za-z0-9_]+)\s*\(/gm

function extractFromFile(filePath: string): { events: string[]; publicSymbols: string[] } {
  try {
    const content = fs.readFileSync(filePath, "utf8")
    const events:  string[] = []
    const symbols: string[] = []

    let m: RegExpExecArray | null

    const evRe = new RegExp(EVENT_RE.source, "g")
    while ((m = evRe.exec(content)) !== null) {
      if (!events.includes(m[1])) events.push(m[1])
    }

    const expRe = new RegExp(EXPORTED_RE.source, "gm")
    while ((m = expRe.exec(content)) !== null) {
      if (!symbols.includes(m[1])) symbols.push(m[1])
    }

    const pubRe = new RegExp(PUBLIC_RE.source, "gm")
    while ((m = pubRe.exec(content)) !== null) {
      if (!symbols.includes(m[1])) symbols.push(m[1])
    }

    return { events, publicSymbols: symbols }
  } catch { return { events: [], publicSymbols: [] } }
}

function walkFiles(dir: string): string[] {
  const results: string[] = []
  if (!fs.existsSync(dir)) return results
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) results.push(...walkFiles(full))
    else if (/\.(js|ts)$/.test(entry.name) && !entry.name.includes(".test.")) results.push(full)
  }
  return results
}

function getPlayerFiles(modId: string, riskMap: RiskMap): string[] {
  const modData = riskMap.modules[modId]
  if (!modData?.files?.length || !PLAYER_REPO) return []

  const files: string[] = []
  for (const pattern of modData.files) {
    const target = path.join(PLAYER_REPO, pattern)
    if (!fs.existsSync(target)) continue
    if (fs.statSync(target).isDirectory()) files.push(...walkFiles(target))
    else files.push(target)
  }
  return files
}

// ─── Análisis de drift por módulo ─────────────────────────────────────────────

async function analyzeModule(modId: string, riskMap: RiskMap): Promise<DriftItem[]> {
  const drifts: DriftItem[] = []

  const bPath = path.join(MODULES_DIR, modId, "behavior.json")
  if (!fs.existsSync(bPath)) return drifts
  let behavior: BehaviorJson
  try { behavior = JSON.parse(fs.readFileSync(bPath, "utf8")) as BehaviorJson }
  catch { return drifts }

  const acs = behavior.acceptance_criteria ?? []
  const knownEvents   = new Set((behavior.events ?? []).map(e => e.name))

  // Extraer símbolos reales del player (si PLAYER_LOCAL_REPO disponible)
  let codeEvents:   string[] = []
  let codeSymbols:  string[] = []

  if (PLAYER_REPO && fs.existsSync(PLAYER_REPO)) {
    const playerFiles = getPlayerFiles(modId, riskMap)
    for (const f of playerFiles) {
      const { events, publicSymbols } = extractFromFile(f)
      codeEvents  = [...new Set([...codeEvents,  ...events])]
      codeSymbols = [...new Set([...codeSymbols, ...publicSymbols])]
    }

    // A. Eventos en código no documentados en behavior.json
    const acGivens = acs.map(ac => [ac.given ?? "", ac.when ?? "", ac.then ?? ""].join(" "))
    for (const evt of codeEvents) {
      const coveredInBehavior = knownEvents.has(evt)
      const mentionedInACs   = acGivens.some(g => g.includes(evt))
      if (!coveredInBehavior && !mentionedInACs) {
        drifts.push({
          module_id:  modId,
          drift_type: "event_in_code_not_in_ac",
          symbol:     evt,
          detail:     `emit('${evt}') encontrado en código pero sin AC ni evento documentado`,
          severity:   "high",
          fix_hint: FIX_HINTS
            ? `Agregar a behavior.json: {"name":"${evt}","when":"<describe cuándo se emite>"}`
            : undefined,
        })
      }
    }

    // B. Métodos públicos exportados sin AC que los mencione
    for (const sym of codeSymbols) {
      const hasAC = acGivens.some(g => g.includes(sym))
      if (!hasAC && sym.length > 4 && !["main", "init", "start", "stop"].includes(sym)) {
        drifts.push({
          module_id:  modId,
          drift_type: "method_in_code_not_in_ac",
          symbol:     sym,
          detail:     `${sym}() exportado en código sin AC que lo ejercite`,
          severity:   "medium",
          fix_hint: FIX_HINTS
            ? `Agregar AC: {"id":"AC-${modId.toUpperCase()}-XXX","scenario":"${sym} funciona correctamente",...}`
            : undefined,
        })
      }
    }
  }

  // C. ACs que referencian eventos que NO existen en knownEvents ni en código
  for (const ac of acs) {
    const text = [ac.given ?? "", ac.when ?? "", ac.then ?? ""].join(" ")
    const mentionedEvts = text.match(/(?:emite|emite|evento|event)\s+['"`]?([A-Za-z][A-Za-z0-9_]+)['"`]?/gi)
      ?.map(m => m.split(/\s+/).pop()?.replace(/['"`,]/g, "") ?? "")
      .filter(Boolean) ?? []

    for (const evt of mentionedEvts) {
      if (codeEvents.length > 0 && !codeEvents.includes(evt) && !knownEvents.has(evt)) {
        drifts.push({
          module_id:  modId,
          drift_type: "ac_references_missing_event",
          symbol:     evt,
          detail:     `AC ${ac.id} menciona evento '${evt}' que no existe en código ni en events[]`,
          severity:   "critical",
          fix_hint: FIX_HINTS ? `Actualizar AC ${ac.id} o verificar nombre del evento en player repo` : undefined,
        })
      }
    }
  }

  // D. covered_by apunta a specs inexistentes
  for (const ac of acs) {
    for (const specPath of ac.covered_by ?? []) {
      const abs = path.join(ROOT, specPath)
      if (!fs.existsSync(abs)) {
        drifts.push({
          module_id:  modId,
          drift_type: "covered_by_points_to_missing",
          symbol:     ac.id,
          detail:     `AC ${ac.id}.covered_by → '${specPath}' no existe en disco`,
          severity:   "high",
          fix_hint: FIX_HINTS ? `Quitar '${specPath}' de covered_by o crear el spec` : undefined,
        })
      }
    }
  }

  return drifts
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const riskMap = yaml.load(fs.readFileSync(RISK_MAP_PATH, "utf8")) as RiskMap
  const allModules = MODULE_FILTER
    ? [MODULE_FILTER]
    : (fs.existsSync(MODULES_DIR) ? fs.readdirSync(MODULES_DIR) : [])

  console.error(`\n${"═".repeat(55)}`)
  console.error(`  KNOWLEDGE DRIFT DETECTION`)
  console.error(`  Módulos: ${allModules.length} | Player repo: ${PLAYER_REPO || "(no configurado)"}`)
  console.error("═".repeat(55))

  const allDrifts: DriftItem[] = []
  const staleCoveredBy: DriftReport["stale_covered_by"] = []

  for (const modId of allModules) {
    const drifts = await analyzeModule(modId, riskMap)
    allDrifts.push(...drifts)

    // Extraer stale covered_by para el reporte
    for (const d of drifts.filter(d => d.drift_type === "covered_by_points_to_missing")) {
      staleCoveredBy.push({
        ac_id:     d.symbol,
        module_id: modId,
        bad_path:  d.detail.match(/'([^']+)' no existe/)?.[1] ?? "",
      })
    }

    if (drifts.length > 0) {
      console.error(`\n  ${modId}: ${drifts.length} drift(s)`)
      for (const d of drifts) {
        const icon = d.severity === "critical" ? "🔴" : d.severity === "high" ? "🟡" : "⚪"
        console.error(`    ${icon} [${d.drift_type}] ${d.symbol}`)
        if (d.fix_hint) console.error(`       → ${d.fix_hint}`)
      }
    }
  }

  const criticalCount = allDrifts.filter(d => d.severity === "critical").length
  const highCount     = allDrifts.filter(d => d.severity === "high").length

  console.error(`\n${"─".repeat(55)}`)
  console.error(`  Total drifts: ${allDrifts.length} (${criticalCount} críticos, ${highCount} altos)`)
  console.error("═".repeat(55))

  const report: DriftReport = {
    analyzed_at:      new Date().toISOString(),
    player_repo:      PLAYER_REPO || "(no configurado)",
    modules_checked:  allModules.length,
    total_drifts:     allDrifts.length,
    drifts:           allDrifts,
    stale_covered_by: staleCoveredBy,
  }

  // stdout = JSON (para integración con pipeline)
  console.log(JSON.stringify(report, null, 2))

  // Exit code no-zero si hay drifts críticos
  if (criticalCount > 0) process.exit(2)
}

main().catch(err => {
  console.error(`ERROR: ${err.message}`)
  process.exit(1)
})
