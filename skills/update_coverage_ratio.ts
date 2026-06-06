#!/usr/bin/env ts-node
/**
 * update_coverage_ratio.ts — Calcula test_coverage_ratio real desde covered_by[]
 *
 * Para cada módulo en risk_map.yaml, busca su behavior.json y calcula:
 *   ratio = ACs con covered_by.length > 0 / total ACs
 *
 * Luego actualiza risk_map.yaml con el ratio calculado.
 * Llamar desde A11 (risk-calibrator) post-merge o manualmente.
 *
 * Uso:
 *   ts-node skills/update_coverage_ratio.ts              # todos los módulos
 *   ts-node skills/update_coverage_ratio.ts --module ads-ima
 *   ts-node skills/update_coverage_ratio.ts --dry-run    # solo muestra, no escribe
 */
import * as path from 'path'
import * as fs from 'fs'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const yaml: { load: (s: string) => unknown; dump: (obj: unknown, opts?: object) => string } = require('js-yaml')

const REPO_ROOT = path.resolve(__dirname, '..')
const RISK_MAP_PATH = path.join(REPO_ROOT, 'risk_map.yaml')
const KA_MODULES_DIR = path.join(REPO_ROOT, 'qa-knowledge', 'modules')

interface AC {
  id?: string
  covered_by?: string[]
  priority?: string
}

interface BehaviorJson {
  module?: string
  acceptance_criteria?: AC[]
}

interface ModuleResult {
  module: string
  total_acs: number
  covered_acs: number
  must_covered: number
  must_total: number
  ratio: number
  old_ratio: number | null
  delta: number
}

function computeRatio(behaviorPath: string): { ratio: number; total: number; covered: number; mustCovered: number; mustTotal: number } | null {
  if (!fs.existsSync(behaviorPath)) return null

  let data: BehaviorJson
  try {
    data = JSON.parse(fs.readFileSync(behaviorPath, 'utf8'))
  } catch {
    return null
  }

  const acs = data.acceptance_criteria ?? []
  if (acs.length === 0) return { ratio: 0, total: 0, covered: 0, mustCovered: 0, mustTotal: 0 }

  const total = acs.length
  const covered = acs.filter((ac) => (ac.covered_by ?? []).length > 0).length
  const mustAcs = acs.filter((ac) => ac.priority === 'MUST')
  const mustTotal = mustAcs.length
  const mustCovered = mustAcs.filter((ac) => (ac.covered_by ?? []).length > 0).length
  const ratio = total > 0 ? Math.round((covered / total) * 100) / 100 : 0

  return { ratio, total, covered, mustCovered, mustTotal }
}

function parseArgs(argv: string[]): { module: string | null; dryRun: boolean } {
  let module: string | null = null
  let dryRun = false
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--module' && argv[i + 1]) { module = argv[++i]; continue }
    if (argv[i] === '--dry-run') { dryRun = true; continue }
  }
  return { module, dryRun }
}

async function main() {
  const { module: targetModule, dryRun } = parseArgs(process.argv.slice(2))

  const riskMapRaw = fs.readFileSync(RISK_MAP_PATH, 'utf8')
  const riskMap = yaml.load(riskMapRaw) as { modules: Record<string, Record<string, unknown>> }

  const results: ModuleResult[] = []

  for (const [modName, modData] of Object.entries(riskMap.modules)) {
    if (targetModule && modName !== targetModule) continue

    const behaviorPath = path.join(KA_MODULES_DIR, modName, 'behavior.json')
    const computed = computeRatio(behaviorPath)
    if (!computed) continue

    const oldRatio = typeof modData['test_coverage_ratio'] === 'number'
      ? modData['test_coverage_ratio'] as number
      : null

    results.push({
      module: modName,
      total_acs: computed.total,
      covered_acs: computed.covered,
      must_covered: computed.mustCovered,
      must_total: computed.mustTotal,
      ratio: computed.ratio,
      old_ratio: oldRatio,
      delta: oldRatio !== null ? Math.round((computed.ratio - oldRatio) * 100) / 100 : 0,
    })

    if (!dryRun) {
      modData['test_coverage_ratio'] = computed.ratio
    }
  }

  // Report
  console.log('\n=== Coverage Ratio Update ===')
  console.log(`Mode: ${dryRun ? 'DRY RUN (no changes written)' : 'WRITE'}`)
  console.log(`Modules processed: ${results.length}\n`)

  for (const r of results) {
    const delta = r.delta > 0 ? `+${r.delta}` : r.delta < 0 ? `${r.delta}` : '='
    const mustStr = r.must_total > 0 ? ` | MUST ${r.must_covered}/${r.must_total}` : ''
    console.log(`  ${r.module.padEnd(25)} ${r.covered_acs}/${r.total_acs} ACs → ratio=${r.ratio} (was ${r.old_ratio ?? 'none'} → ${delta})${mustStr}`)
  }

  if (!dryRun && results.length > 0) {
    fs.writeFileSync(RISK_MAP_PATH, yaml.dump(riskMap, { lineWidth: 120, quotingType: '"' }))
    console.log(`\n✅ risk_map.yaml updated (${results.length} modules)`)
  }

  // Summary
  const mustGaps = results.filter((r) => r.must_total > 0 && r.must_covered < r.must_total)
  if (mustGaps.length > 0) {
    console.log('\n⚠️  MUST gaps remaining:')
    for (const r of mustGaps) {
      console.log(`  ${r.module}: ${r.must_covered}/${r.must_total} MUST ACs covered`)
    }
  } else if (results.length > 0) {
    console.log('\n✅ All MUST ACs covered in processed modules')
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
