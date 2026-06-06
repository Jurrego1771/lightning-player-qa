/**
 * select-tests.ts — Scripted A2+A3: risk scoring + test suite selection
 *
 * Reads tmp/pipeline/diff-input.json + risk_map.yaml.
 * No LLM — pure deterministic logic. Safe to run in CI.
 *
 * Usage:
 *   npx ts-node scripts/select-tests.ts              # human-readable summary
 *   npx ts-node scripts/select-tests.ts --json       # full JSON plan to stdout
 *   npx ts-node scripts/select-tests.ts --commands   # one playwright command per line
 *
 * Output: tmp/pipeline/test-plan.json (always written)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { load as parseYaml } from 'js-yaml'
import * as path from 'path'

const REPO_ROOT = path.resolve(__dirname, '..')
const DIFF_INPUT_PATH = path.join(REPO_ROOT, 'tmp', 'pipeline', 'diff-input.json')
const RISK_MAP_PATH = path.join(REPO_ROOT, 'risk_map.yaml')
const OUTPUT_PATH = path.join(REPO_ROOT, 'tmp', 'pipeline', 'test-plan.json')

// ─── Types ───────────────────────────────────────────────────────────────────

interface DiffInput {
  schema_version: string
  input_ref: string
  cross_cutting_risk: boolean
  cross_cutting_reasons?: string[]
  modules_affected: string[]
  modules_by_criticality: Record<string, string[]>
  total_files_filtered: number
}

interface RiskMapModule {
  risk_label: string
  tests?: string[]
}

interface RiskMap {
  modules: Record<string, RiskMapModule>
}

type RiskLevel = 'critical' | 'high' | 'medium' | 'low'

interface TestPlan {
  schema_version: string
  generated_at: string
  input_ref: string
  risk_label: RiskLevel
  risk_score: number
  risk_reasons: string[]
  modules_affected: string[]
  test_commands: string[]
  estimated_minutes: number
  full_suite_minutes: number
}

// ─── Risk Computation ────────────────────────────────────────────────────────

const RISK_SCORES: Record<RiskLevel, number> = { critical: 4, high: 3, medium: 2, low: 1 }

function computeRisk(
  modules: string[],
  riskMap: RiskMap,
  crossCutting: boolean,
  crossCuttingReasons: string[]
): { label: RiskLevel; score: number; reasons: string[] } {
  const reasons: string[] = []
  let maxScore = 1

  for (const mod of modules) {
    const entry = riskMap.modules[mod]
    if (!entry) {
      reasons.push(`module '${mod}' not in risk_map — treating as medium`)
      maxScore = Math.max(maxScore, RISK_SCORES.medium)
      continue
    }
    const level = entry.risk_label.toLowerCase() as RiskLevel
    const score = RISK_SCORES[level] ?? 1
    if (score > maxScore) {
      maxScore = score
      reasons.push(`${mod} is ${level.toUpperCase()}`)
    }
  }

  if (crossCutting) {
    maxScore = RISK_SCORES.critical
    reasons.push('cross_cutting_risk: ' + (crossCuttingReasons?.join(', ') ?? 'true'))
  }

  if (modules.length === 0) {
    reasons.push('no player modules affected — QA-only change')
    maxScore = RISK_SCORES.low
  }

  const label = (Object.entries(RISK_SCORES).find(([, s]) => s === maxScore)?.[0] ?? 'medium') as RiskLevel
  return { label, score: maxScore, reasons }
}

// ─── Test Suite Selection ─────────────────────────────────────────────────────

function selectTests(
  riskLabel: RiskLevel,
  modules: string[]
): { commands: string[]; minutes: number } {
  const hasUi = modules.some((m) => m.startsWith('ui-'))
  const hasAds = modules.some((m) => m.startsWith('ads-'))
  const hasDrm = modules.includes('drm')

  const smoke = 'npx playwright test tests/smoke/ --project=chromium'
  const contract = 'npx playwright test tests/contract/ --project=chromium'
  const integrationFull = 'npx playwright test tests/integration/ --project=chromium'
  const integrationAds = 'npx playwright test tests/integration/ --project=chromium --grep "@ads"'
  const e2eFull = 'npx playwright test tests/e2e/ --project=chromium'
  const e2eFast = 'npx playwright test tests/e2e/ --project=chromium --grep-invert "@slow"'
  const visual = 'npx playwright test tests/visual/ --project=chromium'

  switch (riskLabel) {
    case 'critical':
      return {
        commands: [
          contract,
          smoke,
          integrationFull,
          e2eFull,
          ...(hasUi ? [visual] : []),
        ],
        minutes: 28,
      }

    case 'high':
      return {
        commands: [
          smoke,
          hasAds ? integrationAds : integrationFull,
          e2eFast,
          ...(hasUi ? [visual] : []),
        ],
        minutes: 15,
      }

    case 'medium':
      return {
        commands: [smoke, integrationFull],
        minutes: 8,
      }

    case 'low':
    default:
      return {
        commands: [smoke],
        minutes: 3,
      }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2)
  const mode = args.includes('--json')
    ? 'json'
    : args.includes('--commands')
    ? 'commands'
    : 'human'

  if (!existsSync(DIFF_INPUT_PATH)) {
    console.error(`ERROR: ${DIFF_INPUT_PATH} not found. Run prepare-diff.ts first.`)
    process.exit(1)
  }

  const diffInput: DiffInput = JSON.parse(readFileSync(DIFF_INPUT_PATH, 'utf-8'))
  const riskMap = parseYaml(readFileSync(RISK_MAP_PATH, 'utf-8')) as RiskMap

  const { label, score, reasons } = computeRisk(
    diffInput.modules_affected,
    riskMap,
    diffInput.cross_cutting_risk,
    diffInput.cross_cutting_reasons ?? []
  )

  const { commands, minutes } = selectTests(label, diffInput.modules_affected)

  const plan: TestPlan = {
    schema_version: '1.0',
    generated_at: new Date().toISOString(),
    input_ref: diffInput.input_ref,
    risk_label: label,
    risk_score: score,
    risk_reasons: reasons,
    modules_affected: diffInput.modules_affected,
    test_commands: commands,
    estimated_minutes: minutes,
    full_suite_minutes: 60,
  }

  mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true })
  writeFileSync(OUTPUT_PATH, JSON.stringify(plan, null, 2) + '\n')

  if (mode === 'json') {
    console.log(JSON.stringify(plan, null, 2))
    return
  }

  if (mode === 'commands') {
    commands.forEach((c) => console.log(c))
    return
  }

  // Human-readable
  const savings = Math.round((1 - minutes / plan.full_suite_minutes) * 100)
  console.log()
  console.log('╔══════════════════════════════════════════════════════════')
  console.log(`║  TEST IMPACT ANALYSIS — ${diffInput.input_ref}`)
  console.log('╠══════════════════════════════════════════════════════════')
  console.log(`║  Risk:    ${label.toUpperCase()} (score ${score}/4)`)
  console.log(`║  Modules: ${diffInput.modules_affected.join(', ') || '(none)'}`)
  console.log(`║  Reasons: ${reasons.join('; ')}`)
  console.log('╠══════════════════════════════════════════════════════════')
  commands.forEach((c, i) => console.log(`║  Step ${i + 1}: ${c}`))
  console.log('╠══════════════════════════════════════════════════════════')
  console.log(`║  ~${minutes} min  (full suite: ~${plan.full_suite_minutes} min · saving ${savings}%)`)
  console.log('╚══════════════════════════════════════════════════════════')
  console.log()
  console.log(`Plan → ${OUTPUT_PATH}`)
}

main()
