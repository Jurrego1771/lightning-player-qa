/**
 * query-context.ts — Query API for the QA knowledge system
 *
 * Usage:
 *   npx ts-node scripts/query-context.ts pipeline-context [modules...]
 *   npx ts-node scripts/query-context.ts acceptance-criteria [module]
 *   npx ts-node scripts/query-context.ts behavior [modules...]
 *   npx ts-node scripts/query-context.ts impact-of [module]
 *   npx ts-node scripts/query-context.ts depended-by [module]
 *   npx ts-node scripts/query-context.ts known-bugs [modules...]
 *   npx ts-node scripts/query-context.ts coverage-gaps [modules...]
 */

import { readFileSync, existsSync, readdirSync } from 'fs'
import { join, resolve } from 'path'
import { load as parseYaml } from 'js-yaml'

// ─── Types ───────────────────────────────────────────────────────────────────

interface ContextYaml {
  module: string
  criticality: string
  paths: string[]
  depends_on: string[]
  depended_by?: string[]
  breaks_if_changed: string[]
  test_suites_required: string[]
  negative_cases: string[]
  known_gaps?: string[]
  external_dependencies?: string[]
  last_reviewed?: string
}

interface BehaviorEvent {
  name: string
  when: string
  payload_shape: Record<string, string>
  must_precede?: string[]
  must_follow?: string[]
  optional?: boolean
}

interface ApiContract {
  method: string
  signature?: string
  expected_behavior: string
  side_effects?: string[]
  error_behavior?: string
}

interface AcceptanceCriterion {
  id: string
  scenario: string
  given: string
  when: string
  then: string
  priority?: 'MUST' | 'SHOULD' | 'NICE'
  covered_by?: string[]
}

interface KnownBug {
  id: string
  title: string
  status: 'open' | 'fixed' | 'wontfix' | 'investigating'
  expected: string
  observed: string
  workaround?: string
}

interface BehaviorJson {
  schema_version: string
  module: string
  status: 'curated' | 'template' | 'stale'
  last_verified: string
  events: BehaviorEvent[]
  api_contracts: ApiContract[]
  acceptance_criteria: AcceptanceCriterion[]
  known_bugs?: KnownBug[]
  do_not_reflag?: string[]
  test_anti_patterns?: string[]
  ci_testable?: Record<string, boolean | string>
}

interface RiskMapModule {
  risk_label: string
  risk_score: number
  files?: string[]
  tests?: string[]
  notes?: string
}

interface RiskMap {
  modules: Record<string, RiskMapModule>
}

interface LoadedModule {
  name: string
  context: ContextYaml | null
  behavior: BehaviorJson | null
  riskData: RiskMapModule | null
}

// ─── Paths ───────────────────────────────────────────────────────────────────

const REPO_ROOT = resolve(__dirname, '..')
const MODULES_DIR = join(REPO_ROOT, 'qa-knowledge', 'modules')
const RISK_MAP_PATH = join(REPO_ROOT, 'risk_map.yaml')

// ─── Loaders ─────────────────────────────────────────────────────────────────

let _riskMap: RiskMap | null = null
function loadRiskMap(): RiskMap {
  if (!_riskMap) {
    _riskMap = parseYaml(readFileSync(RISK_MAP_PATH, 'utf8')) as RiskMap
  }
  return _riskMap
}

function loadModule(name: string): LoadedModule {
  const contextPath = join(MODULES_DIR, name, 'context.yaml')
  const behaviorPath = join(MODULES_DIR, name, 'behavior.json')
  const riskMap = loadRiskMap()

  return {
    name,
    context: existsSync(contextPath)
      ? (parseYaml(readFileSync(contextPath, 'utf8')) as ContextYaml)
      : null,
    behavior: existsSync(behaviorPath)
      ? (JSON.parse(readFileSync(behaviorPath, 'utf8')) as BehaviorJson)
      : null,
    riskData: riskMap.modules[name] ?? null,
  }
}

function allModuleNames(): string[] {
  if (!existsSync(MODULES_DIR)) return Object.keys(loadRiskMap().modules)
  const fromDirs = readdirSync(MODULES_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
  const fromRisk = Object.keys(loadRiskMap().modules)
  return [...new Set([...fromDirs, ...fromRisk])]
}

// ─── Commands ─────────────────────────────────────────────────────────────────

function buildPipelineContext(moduleNames: string[]) {
  const result: Record<string, any> = {}
  const riskMap = loadRiskMap()

  for (const name of moduleNames) {
    const mod = loadModule(name)
    const risk = mod.riskData

    const uncoveredAcs = (mod.behavior?.acceptance_criteria ?? [])
      .filter(ac => !ac.covered_by || ac.covered_by.length === 0)
      .map(ac => ac.id)

    result[name] = {
      criticality: mod.context?.criticality ?? risk?.risk_label ?? 'unknown',
      paths: mod.context?.paths ?? risk?.files ?? [],
      depends_on: mod.context?.depends_on ?? [],
      depended_by: mod.context?.depended_by ?? [],
      breaks_if_changed: mod.context?.breaks_if_changed ?? [],
      test_suites_required: mod.context?.test_suites_required ?? [],
      behavior_status: mod.behavior?.status ?? 'missing',
      events_count: mod.behavior?.events?.length ?? 0,
      acceptance_criteria_count: mod.behavior?.acceptance_criteria?.length ?? 0,
      uncovered_acs: uncoveredAcs,
      known_bugs: (mod.behavior?.known_bugs ?? []).map(b => b.id),
      do_not_reflag: mod.behavior?.do_not_reflag ?? [],
      risk_score: risk?.risk_score ?? null,
    }
  }

  return {
    modules: result,
    cross_module_risks: detectCrossModuleRisks(moduleNames),
    generated_at: new Date().toISOString(),
  }
}

function detectCrossModuleRisks(moduleNames: string[]): string[] {
  const risks: string[] = []
  if (moduleNames.includes('constants')) {
    risks.push('constants modified — all event listeners at risk')
  }
  if (moduleNames.includes('api-bootstrap')) {
    risks.push('api-bootstrap modified — embed initialization at risk')
  }
  if (moduleNames.includes('events')) {
    risks.push('events modified — all modules depending on event bus at risk')
  }
  return risks
}

function buildBehaviorContext(moduleNames: string[]) {
  const result: Record<string, any> = {}
  for (const name of moduleNames) {
    const mod = loadModule(name)
    if (mod.behavior) {
      result[name] = mod.behavior
    } else {
      result[name] = { status: 'missing', module: name, note: 'No behavior.json — check qa-knowledge/modules/' + name }
    }
  }
  return { modules: result, generated_at: new Date().toISOString() }
}

function buildAcceptanceCriteria(moduleNames: string[]) {
  const result: Record<string, any> = {}
  for (const name of moduleNames) {
    const mod = loadModule(name)
    result[name] = {
      module: name,
      acceptance_criteria: mod.behavior?.acceptance_criteria ?? [],
      status: mod.behavior?.status ?? 'missing',
    }
  }
  return result
}

function buildImpactGraph(moduleName: string) {
  const riskMap = loadRiskMap()
  const mod = loadModule(moduleName)
  const allModules = allModuleNames()

  // Find all modules that depend on this one (scan depended_by fields + infer from depends_on)
  const dependedBy: string[] = mod.context?.depended_by ?? []
  // Also scan all context.yamls for depends_on containing this module
  for (const name of allModules) {
    if (name === moduleName) continue
    const other = loadModule(name)
    if (other.context?.depends_on?.includes(moduleName) && !dependedBy.includes(name)) {
      dependedBy.push(name)
    }
  }

  const criticalDependents = dependedBy.filter(name => {
    const r = riskMap.modules[name]
    return r?.risk_label === 'critical'
  })

  return {
    module: moduleName,
    criticality: mod.context?.criticality ?? riskMap.modules[moduleName]?.risk_label ?? 'unknown',
    depends_on: mod.context?.depends_on ?? [],
    depended_by: dependedBy,
    critical_dependents_count: criticalDependents.length,
    cascade_risk: criticalDependents.length >= 2 ? 'CRITICAL_CASCADE' : 'normal',
    cascade_reason: criticalDependents.length >= 2
      ? `${moduleName} has ${criticalDependents.length} CRITICAL dependents: ${criticalDependents.join(', ')}`
      : null,
    breaks_if_changed: mod.context?.breaks_if_changed ?? [],
    generated_at: new Date().toISOString(),
  }
}

function buildDependedBy(moduleName: string) {
  const allModules = allModuleNames()
  const dependedBy: string[] = []
  for (const name of allModules) {
    if (name === moduleName) continue
    const mod = loadModule(name)
    if (mod.context?.depends_on?.includes(moduleName)) {
      dependedBy.push(name)
    }
  }
  return { module: moduleName, depended_by: dependedBy, generated_at: new Date().toISOString() }
}

function getKnownBugs(moduleNames: string[]) {
  const result: Record<string, any> = {}
  for (const name of moduleNames) {
    const mod = loadModule(name)
    result[name] = {
      known_bugs: mod.behavior?.known_bugs ?? [],
      do_not_reflag: mod.behavior?.do_not_reflag ?? [],
    }
  }
  return result
}

function findCoverageGaps(moduleNames: string[]) {
  const riskMap = loadRiskMap()
  const gaps: Array<{
    module: string
    criticality: string
    ac_id: string
    scenario: string
    priority: string
    gap_type: 'MUST' | 'SHOULD' | 'NICE'
    covered_by: string[]
  }> = []

  for (const name of moduleNames) {
    const mod = loadModule(name)
    if (!mod.behavior) continue

    const criticality = mod.context?.criticality ?? riskMap.modules[name]?.risk_label ?? 'low'

    for (const ac of mod.behavior.acceptance_criteria) {
      const hasCoverage = ac.covered_by && ac.covered_by.length > 0
      if (hasCoverage) continue

      let gapType: 'MUST' | 'SHOULD' | 'NICE'
      if (ac.priority === 'MUST' && (criticality === 'critical' || criticality === 'high')) {
        gapType = 'MUST'
      } else if (ac.priority === 'SHOULD' || (ac.priority === 'MUST' && criticality === 'medium')) {
        gapType = 'SHOULD'
      } else {
        gapType = 'NICE'
      }

      gaps.push({
        module: name,
        criticality,
        ac_id: ac.id,
        scenario: ac.scenario,
        priority: ac.priority ?? 'SHOULD',
        gap_type: gapType,
        covered_by: ac.covered_by ?? [],
      })
    }
  }

  const must = gaps.filter(g => g.gap_type === 'MUST')
  const should = gaps.filter(g => g.gap_type === 'SHOULD')
  const nice = gaps.filter(g => g.gap_type === 'NICE')

  return {
    total_gaps: gaps.length,
    must_gaps: must.length,
    should_gaps: should.length,
    nice_gaps: nice.length,
    gaps_by_type: { MUST: must, SHOULD: should, NICE: nice },
    generated_at: new Date().toISOString(),
  }
}

// ─── CLI Entry ────────────────────────────────────────────────────────────────

const [, , command, ...args] = process.argv

if (!command) {
  console.error('Usage: npx ts-node scripts/query-context.ts <command> [modules...]')
  console.error('Commands: pipeline-context | acceptance-criteria | behavior | impact-of | depended-by | known-bugs | coverage-gaps')
  process.exit(1)
}

let output: any

switch (command) {
  case 'pipeline-context':
    output = buildPipelineContext(args.length ? args : allModuleNames())
    break
  case 'acceptance-criteria':
    output = buildAcceptanceCriteria(args.length ? args : allModuleNames())
    break
  case 'behavior':
    output = buildBehaviorContext(args.length ? args : allModuleNames())
    break
  case 'impact-of':
    if (!args[0]) { console.error('impact-of requires a module name'); process.exit(1) }
    output = buildImpactGraph(args[0])
    break
  case 'depended-by':
    if (!args[0]) { console.error('depended-by requires a module name'); process.exit(1) }
    output = buildDependedBy(args[0])
    break
  case 'known-bugs':
    output = getKnownBugs(args.length ? args : allModuleNames())
    break
  case 'coverage-gaps':
    output = findCoverageGaps(args.length ? args : allModuleNames())
    break
  default:
    console.error(`Unknown command: ${command}`)
    process.exit(1)
}

console.log(JSON.stringify(output, null, 2))
