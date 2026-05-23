#!/usr/bin/env ts-node
/**
 * analyze-diff.ts — Reemplaza prepare-diff.sh + agentes diff-analyzer + coverage-checker
 *
 * Hace todo el trabajo determinista en una pasada (~3-5s vs ~3-4 min de agentes):
 *   1. Fetch del diff via @octokit/rest (GitHub) o simple-git (local)
 *   2. Filtrado de ruido (lockfiles, dist, maps)
 *   3. Mapping file → module → risk
 *   4. Parse de patches con parse-diff
 *   5. Grep de cobertura existente en tests/
 *   6. Escribe tmp/pipeline/risk-map.json + coverage-report.json
 *
 * El LLM (review-diff skill) solo añade change_summary + rationale inline — sin subagentes.
 *
 * Uso:
 *   ts-node scripts/analyze-diff.ts           → último commit en main
 *   ts-node scripts/analyze-diff.ts 42        → PR #42
 *   ts-node scripts/analyze-diff.ts feature/x → rama vs main
 *   ts-node scripts/analyze-diff.ts abc1234   → commit específico
 *   ts-node scripts/analyze-diff.ts --local   → repo local (simple-git)
 */

import * as path from 'path'
import * as fs from 'fs'
import * as childProcess from 'child_process'
import { Octokit } from '@octokit/rest'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const parseDiff: (input?: string | null) => import('parse-diff').File[] = require('parse-diff')
import { simpleGit } from 'simple-git'
import * as dotenv from 'dotenv'

dotenv.config({ path: path.resolve(__dirname, '../.env') })

// ── Constants ─────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..')
const OUTPUT_DIR = path.join(REPO_ROOT, 'tmp', 'pipeline')
const PLAYER_GITHUB_REPO = process.env.PLAYER_GITHUB_REPO ?? ''
const PLAYER_LOCAL_REPO = process.env.PLAYER_LOCAL_REPO ?? ''

// File path prefix → module + risk (order matters — more specific first)
const MODULE_MAP = [
  { prefix: 'src/player/base',    module: 'api',        risk: 'CRITICAL' },
  { prefix: 'src/player/ads',     module: 'ads',        risk: 'CRITICAL' },
  { prefix: 'src/player/drm',     module: 'drm',        risk: 'HIGH'     },
  { prefix: 'src/player/handler', module: 'hls',        risk: 'HIGH'     },
  { prefix: 'src/ads',            module: 'ads',        risk: 'CRITICAL' },
  { prefix: 'src/api',            module: 'api',        risk: 'CRITICAL' },
  { prefix: 'src/hls',            module: 'hls',        risk: 'HIGH'     },
  { prefix: 'src/events',         module: 'events',     risk: 'HIGH'     },
  { prefix: 'src/platform',       module: 'platform',   risk: 'HIGH'     },
  { prefix: 'src/drm',            module: 'drm',        risk: 'HIGH'     },
  { prefix: 'src/controls',       module: 'controls',   risk: 'MEDIUM'   },
  { prefix: 'src/analytics',      module: 'analytics',  risk: 'MEDIUM'   },
  { prefix: 'src/ui',             module: 'ui',         risk: 'MEDIUM'   },
  { prefix: 'constants',          module: 'api',        risk: 'HIGH'     },
  { prefix: 'package.json',       module: 'dependency', risk: 'HIGH'     },
] as const

const NOISE_PATTERNS = [
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  '.min.js', '.min.css', '.map', 'dist/', 'build/',
  '.next/', 'coverage/', '.snap', 'CHANGELOG',
]

// Known test files per module (direct coverage)
const COVERAGE_MAP: Record<string, string[]> = {
  ads:        ['tests/integration/ad-beacons.spec.ts'],
  hls:        ['tests/integration/hls-abr.spec.ts'],
  events:     ['tests/e2e/events.spec.ts'],
  api:        ['tests/contract/player-api.spec.ts', 'tests/e2e/player-api.spec.ts'],
  platform:   ['tests/e2e/vod-playback.spec.ts', 'tests/e2e/live-playback.spec.ts'],
  drm:        [],
  controls:   ['tests/e2e/player-api.spec.ts'],
  analytics:  [],
  ui:         ['tests/visual/player-ui.spec.ts', 'tests/a11y/accessibility.spec.ts'],
  dependency: ['tests/smoke/player-smoke.spec.ts', 'tests/e2e/vod-playback.spec.ts', 'tests/e2e/live-playback.spec.ts'],
  other:      ['tests/smoke/player-smoke.spec.ts'],
}

// Keywords that signal coverage when grepped in test files
const MODULE_KEYWORDS: Record<string, string[]> = {
  ads:        ['adsStarted', 'isPlayingAd', 'ad-beacons', 'IMA', 'VAST', 'adsError', 'adsComplete'],
  hls:        ['hls-abr', 'levelchanged', 'ABR', 'bitrate', 'HLS'],
  events:     ['waitForEvent', "player.on("],
  api:        ['player.play()', 'player.pause()', 'player.seek', 'player-api'],
  platform:   ['setupPlatformMocks', 'mockContentConfig', 'mockPlayerConfig'],
  drm:        ['Widevine', 'PlayReady', 'FairPlay', 'drm'],
  controls:   ['aria-label', 'keyboard'],
  analytics:  ['youbora', 'konodrac', 'comscore', 'GA4'],
  ui:         ['toMatchSnapshot', 'screenshot', 'axe'],
  dependency: [],
  other:      [],
}

// ── Types ─────────────────────────────────────────────────────────────────────

type RiskLevel = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
type ChangeType = 'bug-fix' | 'feature' | 'refactor' | 'performance' | 'dependency' | 'ui-change' | 'docs'

interface RawFile {
  filename: string
  status:   string
  patch:    string
  additions: number
  deletions: number
}

interface ProcessedFile {
  path:              string
  status:            string
  module:            string
  risk:              RiskLevel
  stats:             { additions: number; deletions: number }
  signature_changes: string[]
  patch_head:        string
}

interface FetchResult {
  rawFiles:      RawFile[]
  commitMessage: string
  sourceDesc:    string
  prTitle:       string
  prBody:        string
}

// ── Utilities ─────────────────────────────────────────────────────────────────

const log = (msg: string) => process.stderr.write(`  ${msg}\n`)
const die = (msg: string): never => { process.stderr.write(`ERROR: ${msg}\n`); process.exit(1) }

function isNoise(filename: string): boolean {
  return NOISE_PATTERNS.some(p => filename.includes(p))
}

function mapModule(filepath: string): { module: string; risk: RiskLevel } {
  for (const entry of MODULE_MAP) {
    if (filepath.startsWith(entry.prefix)) {
      return { module: entry.module, risk: entry.risk as RiskLevel }
    }
  }
  return { module: 'other', risk: 'MEDIUM' }
}

function extractSignatures(patch: string): string[] {
  return patch.split('\n')
    .filter(line => /^\+[^+].*(function |class |const [A-Z_]|export |module\.exports|prototype\.|=>|async )/.test(line))
    .map(line => line.replace(/^\+/, '').trimStart())
    .slice(0, 15)
}

function detectChangeType(message: string): ChangeType {
  const m = message.toLowerCase()
  if (/\b(fix|bug|hotfix|patch|revert)\b/.test(m))            return 'bug-fix'
  if (/\b(feat|feature|add|new|implement)\b/.test(m))          return 'feature'
  if (/\b(refactor|cleanup|rename|move)\b/.test(m))            return 'refactor'
  if (/\b(perf|optimize|improve performance)\b/.test(m))       return 'performance'
  if (/\b(chore|deps|bump|upgrade|dependency)\b/.test(m))      return 'dependency'
  if (/\b(docs?|comments?)\b/.test(m))                         return 'docs'
  if (/\b(style|css|ui|visual)\b/.test(m))                     return 'ui-change'
  return 'feature'
}

function maxRisk(risks: RiskLevel[]): RiskLevel {
  for (const r of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as RiskLevel[]) {
    if (risks.includes(r)) return r
  }
  return 'LOW'
}

function getOctokit(): Octokit {
  const token = process.env.GITHUB_TOKEN
    ?? process.env.GH_TOKEN
    ?? (() => {
      try { return childProcess.execSync('gh auth token', { encoding: 'utf8' }).trim() }
      catch { return '' }
    })()
  if (!token) die('No GitHub token found. Run `gh auth login` or set GITHUB_TOKEN in .env')
  return new Octokit({ auth: token })
}

// ── Coverage grep ─────────────────────────────────────────────────────────────

function grepCoverage(module: string): { specs: string[]; coverageLevel: 'full' | 'partial' | 'none' } {
  const known = (COVERAGE_MAP[module] ?? []).filter(s => fs.existsSync(path.join(REPO_ROOT, s)))
  const keywords = MODULE_KEYWORDS[module] ?? []
  const found = new Set<string>(known)

  const testsDir = path.join(REPO_ROOT, 'tests')
  if (keywords.length > 0 && fs.existsSync(testsDir)) {
    const regex = new RegExp(
      keywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
      'i'
    )
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.name.endsWith('.spec.ts')) {
          if (regex.test(fs.readFileSync(full, 'utf8')))
            found.add(path.relative(REPO_ROOT, full).replace(/\\/g, '/'))
        }
      }
    }
    walk(testsDir)
  }

  const specs = Array.from(found)
  const coverageLevel = specs.length === 0 ? 'none'
    : known.length > 0 ? 'full'
    : 'partial'

  return { specs, coverageLevel }
}

// ── Process files ─────────────────────────────────────────────────────────────

function processFiles(rawFiles: RawFile[]): {
  files: ProcessedFile[]
  filtered: number
  modulesSet: Set<string>
} {
  const files: ProcessedFile[] = []
  let filtered = 0
  const modulesSet = new Set<string>()

  for (const raw of rawFiles) {
    if (isNoise(raw.filename)) { filtered++; continue }

    const { module, risk } = mapModule(raw.filename)

    // Use parse-diff for structured patch analysis
    const parsed = parseDiff(raw.patch ?? '')
    const allAddedLines = parsed.flatMap(f => f.chunks.flatMap(c => c.changes))
      .filter(c => c.type === 'add')
      .map(c => c.content)
      .join('\n')

    const signatures = extractSignatures('+' + allAddedLines)
    const patchHead = (raw.patch ?? '').split('\n').slice(0, 40).join('\n')

    files.push({
      path: raw.filename,
      status: raw.status,
      module,
      risk,
      stats: { additions: raw.additions, deletions: raw.deletions },
      signature_changes: signatures,
      patch_head: patchHead,
    })
    modulesSet.add(module)
  }

  return { files, filtered, modulesSet }
}

// ── Fetch via Octokit ─────────────────────────────────────────────────────────

async function fetchPR(octokit: Octokit, owner: string, repo: string, prNumber: number): Promise<FetchResult> {
  log(`Fetching PR #${prNumber} desde GitHub...`)

  const [filesRes, prRes] = await Promise.all([
    octokit.pulls.listFiles({ owner, repo, pull_number: prNumber, per_page: 100 }),
    octokit.pulls.get({ owner, repo, pull_number: prNumber }),
  ])

  return {
    rawFiles: filesRes.data.map(f => ({
      filename: f.filename,
      status: f.status,
      patch: f.patch ?? '',
      additions: f.additions,
      deletions: f.deletions,
    })),
    commitMessage: prRes.data.title,
    sourceDesc: `PR #${prNumber} — ${prRes.data.title}`,
    prTitle: prRes.data.title,
    prBody: (prRes.data.body ?? '').split('\n').slice(0, 5).join('\n'),
  }
}

async function fetchBranch(octokit: Octokit, owner: string, repo: string, branch: string): Promise<FetchResult> {
  log(`Fetching rama '${branch}' vs main desde GitHub...`)

  const repoRes = await octokit.repos.get({ owner, repo })
  const base = repoRes.data.default_branch

  const compareRes = await octokit.repos.compareCommitsWithBasehead({
    owner, repo, basehead: `${base}...${branch}`,
  })

  return {
    rawFiles: (compareRes.data.files ?? []).map(f => ({
      filename: f.filename,
      status: f.status,
      patch: f.patch ?? '',
      additions: f.additions,
      deletions: f.deletions,
    })),
    commitMessage: compareRes.data.commits[0]?.commit?.message?.split('\n')[0] ?? '',
    sourceDesc: `branch ${branch} vs ${base}`,
    prTitle: '',
    prBody: '',
  }
}

async function fetchCommit(octokit: Octokit, owner: string, repo: string, sha: string): Promise<FetchResult> {
  log(`Fetching commit ${sha} desde GitHub...`)

  const commitRes = await octokit.repos.getCommit({ owner, repo, ref: sha })

  return {
    rawFiles: (commitRes.data.files ?? []).map(f => ({
      filename: f.filename,
      status: f.status ?? 'modified',
      patch: f.patch ?? '',
      additions: f.additions ?? 0,
      deletions: f.deletions ?? 0,
    })),
    commitMessage: commitRes.data.commit.message.split('\n')[0],
    sourceDesc: `commit ${sha}`,
    prTitle: '',
    prBody: '',
  }
}

async function fetchLatest(octokit: Octokit, owner: string, repo: string): Promise<FetchResult> {
  log('Fetching último commit en main desde GitHub...')
  const commitsRes = await octokit.repos.listCommits({ owner, repo, per_page: 1 })
  return fetchCommit(octokit, owner, repo, commitsRes.data[0].sha)
}

// ── Fetch via simple-git (local fallback) ─────────────────────────────────────

async function fetchLocal(input: string): Promise<FetchResult> {
  if (!PLAYER_LOCAL_REPO) die('PLAYER_LOCAL_REPO no configurado en .env')
  if (!fs.existsSync(PLAYER_LOCAL_REPO)) die(`Repo local no encontrado: ${PLAYER_LOCAL_REPO}`)

  log(`Modo local: ${PLAYER_LOCAL_REPO}`)
  const git = simpleGit(PLAYER_LOCAL_REPO)

  await git.fetch(['origin', '--prune', '--quiet']).catch(() => {})

  let defaultBranch = 'main'
  try {
    const raw = await git.raw(['symbolic-ref', 'refs/remotes/origin/HEAD'])
    defaultBranch = raw.trim().replace('refs/remotes/origin/', '')
  } catch { /* fallback to 'main' */ }

  const target = (input && input !== '--local')
    ? input
    : (await git.branch()).current

  const logResult = await git.log([`${defaultBranch}..${target}`]).catch(() => ({ latest: null }))
  const commitMessage = logResult.latest?.message?.split('\n')[0] ?? ''

  const diffSummary = await git.diffSummary([`${defaultBranch}...${target}`])

  const rawFiles: RawFile[] = []
  for (const diffFile of diffSummary.files) {
    const patch = await git.diff([`${defaultBranch}...${target}`, '--', diffFile.file]).catch(() => '')
    rawFiles.push({
      filename: diffFile.file,
      status: 'modified',
      patch,
      additions: 'insertions' in diffFile ? (diffFile as any).insertions : 0,
      deletions: 'deletions'  in diffFile ? (diffFile as any).deletions  : 0,
    })
  }

  return { rawFiles, commitMessage, sourceDesc: `local ${target}`, prTitle: '', prBody: '' }
}

// ── Build output JSONs ────────────────────────────────────────────────────────

function buildRiskMap(
  files: ProcessedFile[],
  modulesSet: Set<string>,
  changeType: ChangeType,
  sourceDesc: string,
  commitMessage: string,
  prTitle: string,
  prBody: string,
  timestamp: string,
) {
  const testTypeMap: Record<ChangeType, string[]> = {
    'bug-fix':     ['smoke', 'e2e', 'integration'],
    'feature':     ['contract', 'e2e', 'integration', 'smoke'],
    'refactor':    ['e2e', 'integration', 'smoke'],
    'performance': ['performance', 'smoke'],
    'dependency':  ['smoke', 'e2e'],
    'ui-change':   ['visual', 'a11y', 'smoke'],
    'docs':        ['smoke'],
  }

  const moduleNames = Array.from(modulesSet)
  const globalRisk = maxRisk(files.map(f => f.risk).concat(['LOW']))
  const recommendedTestTypes = testTypeMap[changeType] ?? ['smoke']

  const modules = moduleNames.map(moduleName => {
    const mFiles = files.filter(f => f.module === moduleName)
    return {
      name: moduleName,
      player_path: `src/${moduleName}`,
      risk_level: maxRisk(mFiles.map(f => f.risk).concat(['LOW'])),
      changed_files: mFiles.map(f => ({
        path: f.path,
        status: f.status,
        risk: f.risk,
        change_summary: '',  // filled inline by review-diff skill after this script
      })),
      recommended_test_types: recommendedTestTypes,
      suggested_specs: COVERAGE_MAP[moduleName] ?? [],
      // fields filled by coverage step below
      coverage: null as string | null,
      coverage_specs: null as string[] | null,
      open_gaps: null as number | null,
      test_result: null,
      last_run: null,
      verdict: null,
    }
  })

  const suggestedSpecPatterns = Array.from(new Set(moduleNames.flatMap(m => COVERAGE_MAP[m] ?? [])))

  return {
    schema_version: '2.0',
    timestamp,
    input: { source: sourceDesc, description: prTitle || commitMessage },
    change_type: changeType,
    risk_level: globalRisk,
    modules,
    test_priority: suggestedSpecPatterns.length > 0 ? 'run-existing' : 'generate-and-run',
    rationale: '',  // filled inline by review-diff skill
    affected_modules: moduleNames,
    recommended_test_types: recommendedTestTypes,
    suggested_spec_patterns: suggestedSpecPatterns,
  }
}

function buildCoverageReport(
  modules: string[],
  riskMap: ReturnType<typeof buildRiskMap>,
  timestamp: string,
) {
  const coverage = modules.map(moduleName => {
    const { specs, coverageLevel } = grepCoverage(moduleName)
    const moduleData = riskMap.modules.find(m => m.name === moduleName)
    const risk = moduleData?.risk_level ?? 'MEDIUM'

    const existingTests = specs.map(spec => ({
      spec,
      coverage_type: (COVERAGE_MAP[moduleName] ?? []).includes(spec) ? 'direct' : 'indirect',
      test_names: [],
      covers_change: true,
    }))

    const gaps = specs.length === 0 ? [{
      description: `No tests cover the ${moduleName} module`,
      suggested_test_type: moduleName === 'ads' ? 'integration' : 'e2e',
      priority: (risk === 'CRITICAL' || risk === 'HIGH') ? 'MUST' : 'SHOULD',
      spec_location: `tests/integration/${moduleName}.spec.ts`,
      test_description: `Test ${moduleName} module behavior after recent change`,
    }] : []

    return { module: moduleName, risk, existing_tests: existingTests, gaps, coverage_level: coverageLevel }
  })

  const specsToRun = Array.from(new Set(coverage.flatMap(c => c.existing_tests.map(t => t.spec))))
  const specsToGenerate = coverage
    .flatMap(c => c.gaps)
    .filter(g => g.priority === 'MUST')
    .map(g => ({ path: g.spec_location, reason: g.description, priority: 'MUST' as const }))

  const mustGenerate = specsToGenerate.length
  const action = mustGenerate > 0 && specsToRun.length > 0 ? 'run-existing-and-generate'
    : mustGenerate > 0 ? 'generate-then-run'
    : 'run-existing'

  return {
    timestamp,
    modules_analyzed: modules,
    coverage,
    summary: {
      total_modules: modules.length,
      fully_covered: coverage.filter(c => c.coverage_level === 'full').length,
      partially_covered: coverage.filter(c => c.coverage_level === 'partial').length,
      not_covered: coverage.filter(c => c.coverage_level === 'none').length,
      total_gaps: coverage.flatMap(c => c.gaps).length,
      must_generate: mustGenerate,
    },
    action,
    should_generate_tests: mustGenerate > 0,
    specs_to_run: specsToRun,
    specs_to_generate: specsToGenerate,
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Support: --local [branch]  or  <branch|PR|commit>
  const argv2 = process.argv[2] ?? ''
  const argv3 = process.argv[3] ?? ''
  const forceLocal = argv2 === '--local'
  const input = forceLocal ? argv3 : argv2

  // Detect mode
  let mode: 'local' | 'github-pr' | 'github-commit' | 'github-branch' | 'github-latest'
  if (forceLocal) {
    mode = 'local'
  } else if (!PLAYER_GITHUB_REPO) {
    log('PLAYER_GITHUB_REPO no configurado — usando modo local')
    mode = 'local'
  } else if (!input) {
    mode = 'github-latest'
  } else if (/^\d+$/.test(input)) {
    mode = 'github-pr'
  } else if (/^[0-9a-f]{7,40}$/.test(input)) {
    mode = 'github-commit'
  } else {
    mode = 'github-branch'
  }

  log(`Modo: ${mode} | Input: ${input || '(último commit)'}`)
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })

  // Fetch
  let result: FetchResult
  if (mode === 'local') {
    result = await fetchLocal(input)
  } else {
    const [owner, repo] = PLAYER_GITHUB_REPO.split('/')
    const octokit = getOctokit()

    if      (mode === 'github-pr')     result = await fetchPR(octokit, owner, repo, parseInt(input))
    else if (mode === 'github-commit') result = await fetchCommit(octokit, owner, repo, input)
    else if (mode === 'github-branch') result = await fetchBranch(octokit, owner, repo, input)
    else                               result = await fetchLatest(octokit, owner, repo)
  }

  log(`Archivos en diff: ${result.rawFiles.length}`)

  // Process
  const { files, filtered, modulesSet } = processFiles(result.rawFiles)
  const changeType = detectChangeType(result.prTitle || result.commitMessage)
  const timestamp = new Date().toISOString()

  log(`Archivos analizados: ${files.length} (filtrados: ${filtered})`)
  log(`Módulos: ${Array.from(modulesSet).join(', ')}`)

  // Build JSONs
  const riskMap = buildRiskMap(
    files, modulesSet, changeType,
    result.sourceDesc, result.commitMessage, result.prTitle, result.prBody, timestamp,
  )
  const coverageReport = buildCoverageReport(Array.from(modulesSet), riskMap, timestamp)

  // Enrich risk-map modules with coverage data
  for (const mod of riskMap.modules) {
    const cov = coverageReport.coverage.find(c => c.module === mod.name)
    if (cov) {
      mod.coverage = cov.coverage_level
      mod.coverage_specs = cov.existing_tests.map(t => t.spec)
      mod.open_gaps = cov.gaps.filter(g => g.priority === 'MUST').length
    }
  }

  // Write outputs
  fs.writeFileSync(path.join(OUTPUT_DIR, 'risk-map.json'),       JSON.stringify(riskMap,       null, 2))
  fs.writeFileSync(path.join(OUTPUT_DIR, 'coverage-report.json'), JSON.stringify(coverageReport, null, 2))

  log('')
  log(`✅ risk-map.json + coverage-report.json → ${OUTPUT_DIR}`)
  log('')

  // Compact summary to stdout — consumed by review-diff skill
  console.log(JSON.stringify({
    source:          result.sourceDesc,
    change_type:     changeType,
    risk_level:      riskMap.risk_level,
    affected_modules: Array.from(modulesSet),
    files_analyzed:  files.length,
    files_filtered:  filtered,
    specs_to_run:    coverageReport.specs_to_run,
    must_generate:   coverageReport.summary.must_generate,
    action:          coverageReport.action,
  }, null, 2))
}

main().catch(e => { process.stderr.write(`\nFatal: ${(e as Error).message}\n`); process.exit(1) })
