#!/usr/bin/env ts-node
/**
 * get_issue_history.ts — Issues de GitHub filtrados por módulo y período
 *
 * Uso:
 *   ts-node skills/get_issue_history.ts --module ads-ima
 *   ts-node skills/get_issue_history.ts --module hls --days 30 --state all
 *   ts-node skills/get_issue_history.ts --module playback-core --days 180 --state closed
 */

import * as path from 'path'
import * as fs from 'fs'
import { execSync } from 'child_process'
import * as dotenv from 'dotenv'

dotenv.config({ path: path.resolve(__dirname, '../.env') })

// eslint-disable-next-line @typescript-eslint/no-require-imports
const yaml: { load: (s: string) => unknown } = require('js-yaml')

const REPO_ROOT          = path.resolve(__dirname, '..')
const RISK_MAP_PATH      = path.join(REPO_ROOT, 'risk_map.yaml')
const PLAYER_GITHUB_REPO = process.env.PLAYER_GITHUB_REPO ?? ''

const SEVERITY_WEIGHTS: Record<string, number> = {
  critical:    1.00,
  blocker:     1.00,
  high:        0.75,
  major:       0.75,
  medium:      0.50,
  normal:      0.50,
  low:         0.25,
  minor:       0.25,
  enhancement: 0.10,
}

interface GhIssue {
  number:    number
  title:     string
  labels:    Array<{ name: string }>
  createdAt: string
  closedAt:  string | null
  body:      string | null
  url?:      string
}

interface IssueHistoryResult {
  module:           string
  days:             number
  state:            string
  total_bugs:       number
  open_bugs:        number
  closed_bugs:      number
  bug_severity_avg: number
  issues:           Array<{
    number:     number
    title:      string
    state:      'open' | 'closed'
    labels:     string[]
    created_at: string
    closed_at:  string | null
    severity:   number
    url?:       string
  }>
  error?: string
}

function parseArgs(argv: string[]): { module: string; days: number; state: string } {
  let moduleName = ''
  let days       = 90
  let state      = 'all'

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--module' && argv[i + 1]) { moduleName = argv[++i]; continue }
    if (argv[i] === '--days'   && argv[i + 1]) { days  = parseInt(argv[++i], 10); continue }
    if (argv[i] === '--state'  && argv[i + 1]) { state = argv[++i]; continue }
  }

  if (!moduleName) {
    process.stderr.write('ERROR: --module es requerido\n')
    process.exit(1)
  }

  return { module: moduleName, days: isNaN(days) ? 90 : days, state }
}

/** Obtiene labels y key_files del módulo desde risk_map.yaml o player-risk-map.json */
function getModuleMetadata(moduleName: string): { labels: string[]; keyFiles: string[] } {
  // Try risk_map.yaml first
  if (fs.existsSync(RISK_MAP_PATH)) {
    try {
      const parsed = yaml.load(fs.readFileSync(RISK_MAP_PATH, 'utf8')) as Record<string, unknown> | null
      if (parsed && typeof parsed === 'object') {
        let moduleData: Record<string, unknown> | undefined

        if (moduleName in parsed) {
          moduleData = parsed[moduleName] as Record<string, unknown>
        } else if (parsed['modules'] && typeof parsed['modules'] === 'object') {
          const mods = parsed['modules'] as Record<string, unknown>
          if (moduleName in mods) moduleData = mods[moduleName] as Record<string, unknown>
        }

        if (moduleData) {
          return {
            labels:   (moduleData['labels'] as string[] | undefined) ?? [],
            keyFiles: (moduleData['key_files'] as string[] | undefined) ?? (moduleData['file_patterns'] as string[] | undefined) ?? [],
          }
        }
      }
    } catch { /* fall through */ }
  }

  // Try docs/player-risk-map.json
  const jsonPath = path.join(REPO_ROOT, 'docs', 'player-risk-map.json')
  if (fs.existsSync(jsonPath)) {
    try {
      const map = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as {
        features?: Record<string, { key_files?: string[] }>
      }
      return {
        labels:   [],
        keyFiles: map.features?.[moduleName]?.key_files ?? [],
      }
    } catch { /* ignore */ }
  }

  return { labels: [], keyFiles: [] }
}

function isWithinDays(dateStr: string | null, days: number): boolean {
  if (!dateStr) return false
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  return new Date(dateStr).getTime() >= cutoff
}

function getSeverity(labels: string[]): number {
  const lower = labels.map(l => l.toLowerCase())
  for (const [key, weight] of Object.entries(SEVERITY_WEIGHTS)) {
    if (lower.some(l => l.includes(key))) return weight
  }
  return 0.25  // default: treat as low
}

/** Returns true if issue is relevant to the module */
function isRelevantIssue(issue: GhIssue, moduleName: string, moduleLabels: string[], keyFiles: string[]): boolean {
  const titleLower = issue.title.toLowerCase()
  const bodyLower  = (issue.body ?? '').toLowerCase()
  const moduleKey  = moduleName.toLowerCase()

  // Title or body mentions the module name
  if (titleLower.includes(moduleKey) || bodyLower.includes(moduleKey)) return true

  // Label matches
  const issueLabels = issue.labels.map(l => l.name.toLowerCase())
  if (moduleLabels.some(ml => issueLabels.includes(ml.toLowerCase()))) return true

  // Key files mentioned
  if (keyFiles.some(kf => {
    const base = path.basename(kf).toLowerCase()
    return titleLower.includes(base) || bodyLower.includes(base)
  })) return true

  // Module name parts (e.g. "ads-ima" → check for "ima" in title/body)
  const parts = moduleKey.split(/[-_]/)
  if (parts.length > 1 && parts.some(p => p.length > 3 && (titleLower.includes(p) || bodyLower.includes(p)))) return true

  return false
}

async function main() {
  const { module: moduleName, days, state } = parseArgs(process.argv.slice(2))

  if (!PLAYER_GITHUB_REPO) {
    const output: IssueHistoryResult = {
      module: moduleName, days, state,
      total_bugs: 0, open_bugs: 0, closed_bugs: 0, bug_severity_avg: 0,
      issues: [],
      error: 'PLAYER_GITHUB_REPO no configurado en .env',
    }
    console.log(JSON.stringify(output, null, 2))
    process.exit(1)
  }

  const { labels: moduleLabels, keyFiles } = getModuleMetadata(moduleName)

  process.stderr.write(`Módulo: ${moduleName} | Días: ${days} | State: ${state}\n`)
  process.stderr.write(`Repo: ${PLAYER_GITHUB_REPO}\n`)

  // Fetch issues via gh CLI
  let rawIssues: GhIssue[] = []
  try {
    const stateFlag = state === 'all' ? 'all' : state
    const raw = execSync(
      `gh issue list --repo ${PLAYER_GITHUB_REPO} --state ${stateFlag} --limit 200 --json number,title,labels,createdAt,closedAt,body,url`,
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }
    )
    rawIssues = JSON.parse(raw) as GhIssue[]
  } catch (err) {
    const output: IssueHistoryResult = {
      module: moduleName, days, state,
      total_bugs: 0, open_bugs: 0, closed_bugs: 0, bug_severity_avg: 0,
      issues: [],
      error: `gh issue list falló: ${(err as Error).message}`,
    }
    console.log(JSON.stringify(output, null, 2))
    process.exit(1)
  }

  process.stderr.write(`Issues obtenidos: ${rawIssues.length}\n`)

  // Filter by relevance and time window
  const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const relevant = rawIssues.filter(issue => {
    // Must be created within the time window OR closed within it (for 'closed' state)
    const createdRecently = new Date(issue.createdAt) >= cutoffDate
    const closedRecently  = issue.closedAt ? new Date(issue.closedAt) >= cutoffDate : false
    if (!createdRecently && !closedRecently) return false

    return isRelevantIssue(issue, moduleName, moduleLabels, keyFiles)
  })

  process.stderr.write(`Issues relevantes: ${relevant.length}\n`)

  // Build result
  const issues = relevant.map(issue => {
    const labelNames = issue.labels.map(l => l.name)
    const isClosed   = !!issue.closedAt
    return {
      number:     issue.number,
      title:      issue.title,
      state:      (isClosed ? 'closed' : 'open') as 'open' | 'closed',
      labels:     labelNames,
      created_at: issue.createdAt,
      closed_at:  issue.closedAt,
      severity:   getSeverity(labelNames),
      url:        issue.url,
    }
  })

  const openBugs   = issues.filter(i => i.state === 'open').length
  const closedBugs = issues.filter(i => i.state === 'closed').length
  const totalBugs  = issues.length

  const bugSeverityAvg = totalBugs > 0
    ? issues.reduce((sum, i) => sum + i.severity, 0) / totalBugs
    : 0

  const output: IssueHistoryResult = {
    module:           moduleName,
    days,
    state,
    total_bugs:       totalBugs,
    open_bugs:        openBugs,
    closed_bugs:      closedBugs,
    bug_severity_avg: Math.round(bugSeverityAvg * 1000) / 1000,
    issues,
  }

  console.log(JSON.stringify(output, null, 2))
}

main().catch(e => { console.error(JSON.stringify({ error: (e as Error).message })); process.exit(1) })
