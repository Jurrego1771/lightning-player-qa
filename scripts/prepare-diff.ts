/**
 * prepare-diff.ts — Pre-processor for the QA pipeline (replaces A1 inline gh work)
 *
 * Usage:
 *   npx ts-node scripts/prepare-diff.ts 42           # PR number
 *   npx ts-node scripts/prepare-diff.ts feature/ads  # branch name
 *   npx ts-node scripts/prepare-diff.ts abc1234      # commit hash
 *   npx ts-node scripts/prepare-diff.ts HEAD         # last commit on current branch
 *
 * Output: tmp/pipeline/diff-input.json (schema v2.0)
 */

import { execSync } from 'child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { load as parseYaml } from 'js-yaml'
import * as path from 'path'
import * as dotenv from 'dotenv'

dotenv.config()

// ─── Types ───────────────────────────────────────────────────────────────────

interface RiskMapModule {
  risk_label: string
  files?: string[]
}

interface RiskMap {
  modules: Record<string, RiskMapModule>
}

interface FileEntry {
  path: string
  module: string
  criticality: string
  inferred: boolean
  lines_added: number
  lines_removed: number
  status: string
  symbols_changed: string[]
  events_touched: string[]
  patch_truncated: boolean
  patch: string
}

interface DiffInput {
  schema_version: string
  prepared_at: string
  input_ref: string
  input_type: 'pr' | 'branch' | 'commit' | 'head'
  player_github_repo: string
  cross_cutting_risk: boolean
  cross_cutting_reasons: string[]
  total_files_raw: number
  total_files_filtered: number
  files_excluded: string[]
  files: FileEntry[]
  modules_affected: string[]
  modules_by_criticality: Record<string, string[]>
}

// ─── Config ───────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..')
const RISK_MAP_PATH = path.join(REPO_ROOT, 'risk_map.yaml')
const OUTPUT_PATH = path.join(REPO_ROOT, 'tmp', 'pipeline', 'diff-input.json')

const PLAYER_GITHUB_REPO = process.env.PLAYER_GITHUB_REPO || ''

const PATCH_LIMITS: Record<string, number> = {
  critical: 200,
  high: 80,
  medium: 0,
  low: 0,
}

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
]

const CROSS_CUTTING_FILES = ['constants.cjs', 'src/api/api.js']

// ─── Module Map ───────────────────────────────────────────────────────────────

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
): { module: string; criticality: string; inferred: boolean } {
  // Exact match
  if (moduleMap.has(filePath)) {
    return { ...moduleMap.get(filePath)!, inferred: false }
  }

  // Prefix match (longest wins)
  let best: { module: string; criticality: string; prefix: string } | null = null
  for (const [prefix, data] of moduleMap.entries()) {
    if (filePath.startsWith(prefix + '/') || filePath.startsWith(prefix)) {
      if (!best || prefix.length > best.prefix.length) {
        best = { ...data, prefix }
      }
    }
  }
  if (best) return { module: best.module, criticality: best.criticality, inferred: false }

  // Infer from parent directory
  const parts = filePath.split('/')
  if (parts.length >= 2) {
    const inferred = parts.slice(0, 2).join('/')
    return { module: inferred, criticality: 'low', inferred: true }
  }

  return { module: 'unknown', criticality: 'low', inferred: true }
}

// ─── Patch Analysis ──────────────────────────────────────────────────────────

function extractSymbols(patch: string): string[] {
  const symbols = new Set<string>()
  const addedLines = patch.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++'))
  for (const line of addedLines) {
    const fnMatch = line.match(/(?:function|const|class|export\s+(?:default\s+)?(?:function|class|const))\s+(\w+)/)
    if (fnMatch) symbols.add(fnMatch[1])
    const arrowMatch = line.match(/(?:^|\s)(\w+)\s*[=:]\s*(?:async\s*)?\(/)
    if (arrowMatch && arrowMatch[1].length > 2) symbols.add(arrowMatch[1])
  }
  return [...symbols]
}

function extractEvents(patch: string): string[] {
  const events = new Set<string>()
  const addedLines = patch.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++'))
  for (const line of addedLines) {
    const eventsMatch = line.matchAll(/Events\.(\w+)/g)
    for (const m of eventsMatch) events.add(`Events.${m[1]}`)
    const emitMatch = line.matchAll(/emit\(['"](\w+)['"]/g)
    for (const m of emitMatch) events.add(m[1])
    const dispatchMatch = line.matchAll(/dispatchEvent\(['"](\w+)['"]/g)
    for (const m of dispatchMatch) events.add(m[1])
  }
  return [...events]
}

function truncatePatch(patch: string, criticality: string): { patch: string; truncated: boolean } {
  const limit = PATCH_LIMITS[criticality] ?? 0
  if (limit === 0) return { patch: '', truncated: patch.length > 0 }
  const lines = patch.split('\n')
  if (lines.length <= limit) return { patch, truncated: false }
  return { patch: lines.slice(0, limit).join('\n'), truncated: true }
}

// ─── Input Type Detection ─────────────────────────────────────────────────────

function detectInputType(ref: string): 'pr' | 'branch' | 'commit' | 'head' {
  if (ref === 'HEAD') return 'head'
  if (/^\d+$/.test(ref)) return 'pr'
  if (/^[0-9a-f]{7,40}$/.test(ref)) return 'commit'
  return 'branch'
}

// ─── Diff Fetchers ────────────────────────────────────────────────────────────

function exec(cmd: string): string {
  return execSync(cmd, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 })
}

interface RawFile {
  path: string
  additions: number
  deletions: number
  status: string
  patch: string
}

function fetchPR(prNumber: string): RawFile[] {
  const filesJson = exec(`gh pr view "${prNumber}" --repo "${PLAYER_GITHUB_REPO}" --json files`)
  const files = JSON.parse(filesJson).files as Array<{
    path: string
    additions: number
    deletions: number
    status: string
  }>

  // Get full patch via gh pr diff
  let patchText = ''
  try {
    patchText = exec(`gh pr diff "${prNumber}" --repo "${PLAYER_GITHUB_REPO}"`)
  } catch {
    // patch is optional
  }

  const patches = parsePatchText(patchText)

  return files.map(f => ({
    path: f.path,
    additions: f.additions,
    deletions: f.deletions,
    status: f.status,
    patch: patches.get(f.path) ?? '',
  }))
}

function fetchBranch(branchRef: string): RawFile[] {
  // Parse full JSON — avoid --jq with single quotes (breaks on Windows)
  const repoJson = exec(`gh api "repos/${PLAYER_GITHUB_REPO}"`)
  const baseBranch = JSON.parse(repoJson).default_branch as string

  const compareJson = exec(
    `gh api "repos/${PLAYER_GITHUB_REPO}/compare/${baseBranch}...${branchRef}"`
  )
  const files = JSON.parse(compareJson).files as Array<{
    filename: string; additions: number; deletions: number; status: string; patch?: string
  }>
  return files.map(f => ({
    path: f.filename, additions: f.additions, deletions: f.deletions,
    status: f.status, patch: f.patch ?? '',
  }))
}

function fetchCommit(commitHash: string): RawFile[] {
  // Parse full JSON — avoid --jq with single quotes (breaks on Windows)
  const commitJson = exec(
    `gh api "repos/${PLAYER_GITHUB_REPO}/commits/${commitHash}"`
  )
  const files = JSON.parse(commitJson).files as Array<{
    filename: string; additions: number; deletions: number; status: string; patch?: string
  }>
  return files.map(f => ({
    path: f.filename, additions: f.additions, deletions: f.deletions,
    status: f.status, patch: f.patch ?? '',
  }))
}

function fetchHead(): RawFile[] {
  // Use player repo HEAD, not QA repo HEAD
  if (process.env.PLAYER_LOCAL_REPO) {
    const commitHash = exec(`git -C "${process.env.PLAYER_LOCAL_REPO}" rev-parse HEAD`).trim()
    return fetchCommit(commitHash)
  }
  // Fallback: get player repo default branch HEAD via gh API
  const repoJson = exec(`gh api "repos/${PLAYER_GITHUB_REPO}"`)
  const defaultBranch = JSON.parse(repoJson).default_branch as string
  const refJson = exec(`gh api "repos/${PLAYER_GITHUB_REPO}/git/ref/heads/${defaultBranch}"`)
  const sha = JSON.parse(refJson).object.sha as string
  return fetchCommit(sha)
}


function parsePatchText(patchText: string): Map<string, string> {
  const map = new Map<string, string>()
  const fileBlocks = patchText.split(/^diff --git /m).slice(1)
  for (const block of fileBlocks) {
    const match = block.match(/^a\/(.+?) b\//)
    if (!match) continue
    const filePath = match[1]
    map.set(filePath, block)
  }
  return map
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const [, , inputRef] = process.argv

  if (!inputRef) {
    console.error('Usage: npx ts-node scripts/prepare-diff.ts <PR|branch|commit|HEAD>')
    process.exit(1)
  }

  if (!PLAYER_GITHUB_REPO) {
    console.error('ERROR: PLAYER_GITHUB_REPO not set in .env')
    console.error('Example: PLAYER_GITHUB_REPO=mediastream/lightning-player')
    process.exit(1)
  }

  // Verify gh auth
  try {
    exec('gh auth status')
  } catch {
    console.error('ERROR: gh CLI not authenticated. Run: gh auth login')
    process.exit(1)
  }

  // Load risk map
  const riskMap = parseYaml(readFileSync(RISK_MAP_PATH, 'utf8')) as RiskMap
  const moduleMap = buildModuleMap(riskMap)

  // Detect input type and fetch raw files
  const inputType = detectInputType(inputRef)
  console.log(`Fetching diff for ${inputType}: ${inputRef} ...`)

  let rawFiles: RawFile[]
  try {
    switch (inputType) {
      case 'pr':     rawFiles = fetchPR(inputRef); break
      case 'branch': rawFiles = fetchBranch(inputRef); break
      case 'commit': rawFiles = fetchCommit(inputRef); break
      case 'head':   rawFiles = fetchHead(); break
    }
  } catch (err: any) {
    console.error(`ERROR fetching diff: ${err.message}`)
    process.exit(1)
  }

  const totalRaw = rawFiles.length
  const excluded: string[] = []

  // Filter noise
  const relevant = rawFiles.filter(f => {
    const isNoise = NOISE_PATTERNS.some(p => p.test(f.path))
    if (isNoise) excluded.push(f.path)
    return !isNoise
  })

  // Cross-cutting detection
  const crossCuttingReasons: string[] = []
  for (const f of relevant) {
    if (CROSS_CUTTING_FILES.some(cc => f.path === cc || f.path.endsWith('/' + cc))) {
      crossCuttingReasons.push(`${f.path} modificado — afecta contratos públicos`)
    }
  }

  // Classify and build file entries
  const files: FileEntry[] = relevant.map(f => {
    const { module, criticality, inferred } = classifyFile(f.path, moduleMap)
    const symbols = extractSymbols(f.patch)
    const events = extractEvents(f.patch)
    const { patch: truncatedPatch, truncated } = truncatePatch(f.patch, criticality)

    return {
      path: f.path,
      module,
      criticality,
      inferred,
      lines_added: f.additions,
      lines_removed: f.deletions,
      status: f.status,
      symbols_changed: symbols,
      events_touched: events,
      patch_truncated: truncated,
      patch: truncatedPatch,
    }
  })

  // Build module sets
  const moduleSet = new Set(files.map(f => f.module))
  const byCriticality: Record<string, string[]> = { critical: [], high: [], medium: [], low: [] }
  for (const f of files) {
    const bucket = byCriticality[f.criticality] ?? (byCriticality[f.criticality] = [])
    if (!bucket.includes(f.module)) bucket.push(f.module)
  }
  // Deduplicate
  for (const key of Object.keys(byCriticality)) {
    byCriticality[key] = [...new Set(byCriticality[key])]
  }

  const output: DiffInput = {
    schema_version: '2.0',
    prepared_at: new Date().toISOString(),
    input_ref: inputRef,
    input_type: inputType,
    player_github_repo: PLAYER_GITHUB_REPO,
    cross_cutting_risk: crossCuttingReasons.length > 0,
    cross_cutting_reasons: crossCuttingReasons,
    total_files_raw: totalRaw,
    total_files_filtered: relevant.length,
    files_excluded: excluded,
    files,
    modules_affected: [...moduleSet],
    modules_by_criticality: byCriticality,
  }

  mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true })
  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2))

  console.log(`\n${'═'.repeat(60)}`)
  console.log(`  PREPARE-DIFF — ${inputRef} (${inputType})`)
  console.log('═'.repeat(60))
  console.log(`  Files raw: ${totalRaw} → filtered: ${relevant.length} (excluded: ${excluded.length})`)
  console.log(`  Modules affected: ${[...moduleSet].join(', ')}`)
  if (crossCuttingReasons.length > 0) {
    console.log(`  ⚠️  cross_cutting_risk: true`)
    for (const r of crossCuttingReasons) console.log(`     ${r}`)
  }
  console.log(`  Output: ${OUTPUT_PATH}`)
  console.log('═'.repeat(60))
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
