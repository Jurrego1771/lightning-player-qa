/**
 * discover-unmapped.ts
 *
 * Descubre archivos del player repo que no están mapeados en risk_map.yaml.
 * Los agrupa por directorio, usa Haiku para sugerir módulos y genera YAML
 * listo para pegar en risk_map.yaml.
 *
 * Uso:
 *   npx ts-node scripts/discover-unmapped.ts
 *   npx ts-node scripts/discover-unmapped.ts --no-llm   # solo estadísticas, sin LLM
 *
 * Output:
 *   tmp/risk_map_additions.yaml  — YAML con nuevos módulos/entradas sugeridas
 */

import { execSync } from 'child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { load as parseYaml, dump as dumpYaml } from 'js-yaml'
import * as path from 'path'
import * as dotenv from 'dotenv'
import { callClaudeJson } from '../src/llm/claude-cli'

dotenv.config()

// ─── Types ───────────────────────────────────────────────────────────────────

interface RiskMapModule {
  risk_label: string
  risk_score?: number
  files?: string[]
}

interface RiskMap {
  modules: Record<string, RiskMapModule>
}

interface ClassifyResult {
  module: string
  criticality: string
  inferred: boolean
}

// ─── Config ───────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..')
const RISK_MAP_PATH = path.join(REPO_ROOT, 'risk_map.yaml')
const OUTPUT_PATH = path.join(REPO_ROOT, 'tmp', 'risk_map_additions.yaml')
const PLAYER_REPO = process.env.PLAYER_LOCAL_REPO || ''
const USE_LLM = !process.argv.includes('--no-llm')

// Same patterns as prepare-diff.ts — keep in sync
const NOISE_PATTERNS = [
  /^dist\//,
  /^node_modules\//,
  /\.map$/,
  /^package-lock\.json$/,
  /\.snap$/,
  /^playwright-report\//,
  /^tmp\//,
  /^blob-report\//,
  /^test-results\//,
  /^\./,
  /^(assets|bash|cli|docs|test)\//,
  /^webpack\./,
  /^[^/]+\.(config\.(cjs|mjs|js|ts)|toml)$/,
  /^(jsconfig|tsconfig[^/]*)\.json$/,
  /^[^/]+\.md$/,
  // dev-only dirs in player (not shipped)
  /^src\/dev-ui\//,
  /^src\/babel\//,
  // test files
  /\.(spec|test)\.(ts|js|tsx|jsx)$/,
  /\/__tests__\//,
]

// ─── Module map (same logic as prepare-diff.ts) ───────────────────────────────

function buildModuleMap(riskMap: RiskMap): Map<string, { module: string; criticality: string }> {
  const map = new Map<string, { module: string; criticality: string }>()
  for (const [name, data] of Object.entries(riskMap.modules)) {
    for (const filePath of data.files ?? []) {
      const normalized = filePath.replace(/\/$/, '')
      map.set(normalized, { module: name, criticality: data.risk_label })
    }
  }
  return map
}

function classifyFile(
  filePath: string,
  moduleMap: Map<string, { module: string; criticality: string }>
): ClassifyResult {
  if (moduleMap.has(filePath)) {
    return { ...moduleMap.get(filePath)!, inferred: false }
  }
  let best: { module: string; criticality: string; prefix: string } | null = null
  for (const [prefix, data] of moduleMap.entries()) {
    if (filePath.startsWith(prefix + '/') || filePath.startsWith(prefix)) {
      if (!best || prefix.length > best.prefix.length) {
        best = { ...data, prefix }
      }
    }
  }
  if (best) return { module: best.module, criticality: best.criticality, inferred: false }
  return { module: 'unknown', criticality: 'low', inferred: true }
}

function isNoise(filePath: string): boolean {
  return NOISE_PATTERNS.some(p => p.test(filePath))
}

// ─── Group unmapped files by directory prefix ─────────────────────────────────

function groupByDirectory(files: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>()
  for (const f of files) {
    const parts = f.split('/')
    // Use up to 3 directory segments as the group key
    const groupKey = parts.length > 1
      ? parts.slice(0, Math.min(3, parts.length - 1)).join('/') + '/'
      : f
    if (!groups.has(groupKey)) groups.set(groupKey, [])
    groups.get(groupKey)!.push(f)
  }
  // Merge small groups (< 2 files) into parent
  const merged = new Map<string, string[]>()
  for (const [key, files] of groups.entries()) {
    if (files.length >= 2) {
      merged.set(key, files)
    } else {
      // Use 2-segment parent
      const parts = key.split('/')
      const parentKey = parts.slice(0, Math.min(2, parts.length - 1)).join('/') + '/'
      if (!merged.has(parentKey)) merged.set(parentKey, [])
      merged.get(parentKey)!.push(...files)
    }
  }
  return merged
}

// ─── LLM classification ───────────────────────────────────────────────────────

interface LLMSuggestion {
  directory: string
  suggested_module: string
  action: 'add_to_existing' | 'new_module'
  existing_module?: string
  risk_label: 'critical' | 'high' | 'medium' | 'low'
  risk_score: number
  reasoning: string
}

interface LLMBatchResult {
  suggestions: LLMSuggestion[]
}

async function classifyGroupsWithLLM(
  groups: Map<string, string[]>,
  existingModules: string[]
): Promise<LLMSuggestion[]> {
  const groupList = [...groups.entries()].map(([dir, files]) => ({
    directory: dir,
    sample_files: files.slice(0, 8),
    total_files: files.length,
  }))

  const prompt = `You are a QA risk analyst for a video player repository (Lightning Player by Mediastream).
Your job is to classify unmapped source directories into risk modules for a risk_map.yaml file.

EXISTING MODULES (already in risk_map):
${existingModules.join(', ')}

UNMAPPED DIRECTORIES TO CLASSIFY:
${JSON.stringify(groupList, null, 2)}

For each directory, suggest:
- action: "add_to_existing" (files belong to an existing module, just add the path prefix) OR "new_module" (needs a new entry)
- suggested_module: name for new module (kebab-case) or existing module name if add_to_existing
- existing_module: if action=add_to_existing, which existing module to add the path to
- risk_label: "critical"|"high"|"medium"|"low" based on what the code does
- risk_score: 0.0-1.0 numeric score matching risk_label (critical≥0.85, high≥0.65, medium≥0.40, low<0.40)
- reasoning: one sentence why this risk level

Risk guidance for player code:
- critical: bootstrap, event system, state management, DRM key exchange
- high: ad integrations, playback handlers, analytics beacons
- medium: UI components, metadata, feature flags, hooks
- low: utilities, dev tools, error displays, helpers

Respond JSON only:
{
  "suggestions": [
    {
      "directory": "src/airplay/",
      "suggested_module": "airplay",
      "action": "new_module",
      "risk_label": "medium",
      "risk_score": 0.55,
      "reasoning": "AirPlay casting feature, failure degrades iOS experience but doesn't break core playback"
    }
  ]
}`

  const result = await callClaudeJson<LLMBatchResult>(prompt, { model: 'haiku', timeoutMs: 60_000 })
  return result.suggestions
}

// ─── Generate YAML ────────────────────────────────────────────────────────────

function generateYaml(
  suggestions: LLMSuggestion[],
  groups: Map<string, string[]>,
  existingModules: Set<string>
): string {
  const newModules: Record<string, unknown> = {}
  const addToExisting: Array<{ module: string; add_path: string }> = []

  for (const s of suggestions) {
    const files = groups.get(s.directory) ?? []

    if (s.action === 'new_module' && !existingModules.has(s.suggested_module)) {
      newModules[s.suggested_module] = {
        risk_score: s.risk_score,
        risk_label: s.risk_label,
        signals: {
          file_count: files.length,
          commit_frequency_90d: 0,
          bugs_closed_90d: 0,
          bug_severity_avg: 0,
          test_coverage_ratio: 0,
          ci_failure_rate: 0,
        },
        files: [s.directory],
        tests: [],
        notes: s.reasoning,
      }
    } else if (s.action === 'add_to_existing' && s.existing_module) {
      addToExisting.push({ module: s.existing_module, add_path: s.directory })
    }
  }

  const output = {
    '# NEW MODULES — paste into risk_map.yaml under modules:': null,
    new_modules: newModules,
    '# ADD TO EXISTING MODULES — add these paths to the files[] of each module': null,
    add_to_existing: addToExisting,
  }

  return [
    '# Generated by discover-unmapped.ts',
    `# Run at: ${new Date().toISOString()}`,
    '# Review before merging into risk_map.yaml',
    '#',
    '# 1. Copy entries under new_modules: into risk_map.yaml modules:',
    '# 2. For add_to_existing: add the path to the files[] of the named module',
    '',
    dumpYaml(output, { lineWidth: 120 }),
  ].join('\n')
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!PLAYER_REPO) {
    console.error('ERROR: PLAYER_LOCAL_REPO not set in .env')
    process.exit(1)
  }

  console.log(`${'═'.repeat(55)}`)
  console.log('  DISCOVER-UNMAPPED — Lightning Player')
  console.log('═'.repeat(55))

  // Load risk_map
  const riskMap = parseYaml(readFileSync(RISK_MAP_PATH, 'utf8')) as RiskMap
  const moduleMap = buildModuleMap(riskMap)
  const existingModules = new Set(Object.keys(riskMap.modules))

  // Get all tracked files from player repo
  const allFiles = execSync(`git -C "${PLAYER_REPO}" ls-files`, { encoding: 'utf8' })
    .split('\n')
    .map(f => f.trim())
    .filter(Boolean)

  const totalRaw = allFiles.length

  // Filter noise
  const relevant = allFiles.filter(f => !isNoise(f))
  const noiseCount = totalRaw - relevant.length

  // Classify each file
  const mapped: string[] = []
  const unmapped: string[] = []

  for (const f of relevant) {
    const result = classifyFile(f, moduleMap)
    if (result.inferred) {
      unmapped.push(f)
    } else {
      mapped.push(f)
    }
  }

  console.log(`  Player repo:   ${PLAYER_REPO}`)
  console.log(`  Total files:   ${totalRaw}`)
  console.log(`  Noise/config:  ${noiseCount} (${Math.round(noiseCount / totalRaw * 100)}%)`)
  console.log(`  Already mapped: ${mapped.length} (${Math.round(mapped.length / totalRaw * 100)}%)`)
  console.log(`  UNMAPPED gaps:  ${unmapped.length} (${Math.round(unmapped.length / totalRaw * 100)}%)`)
  console.log()

  if (unmapped.length === 0) {
    console.log('  ✅ All files mapped! risk_map.yaml has full coverage.')
    return
  }

  // Group unmapped files by directory
  const groups = groupByDirectory(unmapped)

  console.log(`  Gaps by directory (${groups.size} groups):`)
  for (const [dir, files] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ├─ ${dir.padEnd(40)} ${files.length} files`)
  }
  console.log()

  let suggestions: LLMSuggestion[] = []

  if (USE_LLM) {
    console.log('  Calling Haiku to classify groups...')
    try {
      suggestions = await classifyGroupsWithLLM(groups, [...existingModules])
      console.log(`  ✅ Haiku classified ${suggestions.length} groups`)
      console.log()
      console.log('  Suggested actions:')
      for (const s of suggestions) {
        const action = s.action === 'new_module'
          ? `NEW: ${s.suggested_module} [${s.risk_label}]`
          : `ADD to ${s.existing_module}`
        console.log(`  ├─ ${s.directory.padEnd(35)} → ${action}`)
      }
    } catch (err) {
      console.error(`  ⚠️  LLM failed: ${(err as Error).message}`)
      console.error('  Run with --no-llm to skip LLM classification.')
    }
  } else {
    console.log('  --no-llm flag: skipping LLM classification')
    // Generate placeholder suggestions for each group
    for (const [dir] of groups.entries()) {
      const parts = dir.split('/').filter(Boolean)
      suggestions.push({
        directory: dir,
        suggested_module: parts[parts.length - 1] ?? 'unknown',
        action: 'new_module',
        risk_label: 'low',
        risk_score: 0.3,
        reasoning: 'Manual review required',
      })
    }
  }

  // Generate YAML output
  const yaml = generateYaml(suggestions, groups, existingModules)
  mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true })
  writeFileSync(OUTPUT_PATH, yaml)

  console.log()
  console.log(`  Output: ${OUTPUT_PATH}`)
  console.log()
  console.log('  Next steps:')
  console.log('  1. Review tmp/risk_map_additions.yaml')
  console.log('  2. Correct any wrong suggestions')
  console.log('  3. Copy new_modules entries into risk_map.yaml under modules:')
  console.log('  4. Add paths from add_to_existing to files[] of each module')
  console.log('  5. Re-run: npx ts-node scripts/discover-unmapped.ts --no-llm')
  console.log('     to verify 0 gaps remain')
  console.log(`${'═'.repeat(55)}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
