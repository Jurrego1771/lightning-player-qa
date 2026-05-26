#!/usr/bin/env ts-node
/**
 * get_commit_frequency.ts — Frecuencia de commits en los archivos de un módulo
 *
 * Uso:
 *   ts-node skills/get_commit_frequency.ts --module ads-ima
 *   ts-node skills/get_commit_frequency.ts --module hls --days 30
 */

import * as path from 'path'
import * as fs from 'fs'
import { execSync } from 'child_process'
import * as dotenv from 'dotenv'

dotenv.config({ path: path.resolve(__dirname, '../.env') })

// js-yaml loaded via require for ts-node + esModuleInterop compatibility
// eslint-disable-next-line @typescript-eslint/no-require-imports
const yaml: { load: (s: string) => unknown } = require('js-yaml')

const REPO_ROOT        = path.resolve(__dirname, '..')
const RISK_MAP_PATH    = path.join(REPO_ROOT, 'risk_map.yaml')
const PLAYER_LOCAL_REPO = process.env.PLAYER_LOCAL_REPO ?? ''
const PLAYER_GITHUB_REPO = process.env.PLAYER_GITHUB_REPO ?? ''

interface RiskMapModule {
  file_patterns?: string[]
  key_files?: string[]
  [key: string]: unknown
}

interface CommitFrequencyResult {
  module:          string
  days:            number
  commit_count:    number
  file_patterns:   string[]
  per_file:        Record<string, number>
  source:          'local' | 'github-api' | 'error'
  error?:          string
}

function parseArgs(argv: string[]): { module: string; days: number } {
  let moduleName = ''
  let days       = 90

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--module' && argv[i + 1]) { moduleName = argv[++i]; continue }
    if (argv[i] === '--days'   && argv[i + 1]) { days = parseInt(argv[++i], 10); continue }
  }

  if (!moduleName) {
    process.stderr.write('ERROR: --module es requerido\n')
    process.exit(1)
  }

  return { module: moduleName, days: isNaN(days) ? 90 : days }
}

/** Obtiene file patterns del módulo desde risk_map.yaml */
function getFilePatterns(moduleName: string): string[] {
  if (!fs.existsSync(RISK_MAP_PATH)) {
    process.stderr.write(`WARN: risk_map.yaml no encontrado en ${RISK_MAP_PATH}\n`)
    return []
  }

  try {
    const raw    = fs.readFileSync(RISK_MAP_PATH, 'utf8')
    const parsed = yaml.load(raw) as Record<string, unknown> | null

    if (!parsed || typeof parsed !== 'object') return []

    // Support both { modules: { [name]: {...} } } and { [name]: {...} }
    let moduleData: RiskMapModule | undefined

    if (moduleName in parsed) {
      moduleData = parsed[moduleName] as RiskMapModule
    } else if (parsed['modules'] && typeof parsed['modules'] === 'object') {
      const mods = parsed['modules'] as Record<string, unknown>
      if (moduleName in mods) moduleData = mods[moduleName] as RiskMapModule
    }

    if (!moduleData) return []

    // Accept file_patterns or key_files
    return (moduleData.file_patterns ?? moduleData.key_files ?? []) as string[]
  } catch (err) {
    process.stderr.write(`WARN: Error parseando risk_map.yaml: ${(err as Error).message}\n`)
    return []
  }
}

/** Fallback: obtiene file patterns del módulo desde docs/player-risk-map.json */
function getFilePatternsFromJson(moduleName: string): string[] {
  const jsonPath = path.join(REPO_ROOT, 'docs', 'player-risk-map.json')
  if (!fs.existsSync(jsonPath)) return []

  try {
    const map = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as {
      features?: Record<string, { key_files?: string[] }>
    }
    return map.features?.[moduleName]?.key_files ?? []
  } catch {
    return []
  }
}

/** Cuenta commits para un file pattern usando git log en el repo local */
function countLocalCommits(repoPath: string, pattern: string, days: number): number {
  try {
    // On Windows: wc -l may not be available; use cross-platform approach
    const output = execSync(
      `git -C "${repoPath}" log --since=${days}.days.ago --oneline -- "${pattern}"`,
      { encoding: 'utf8', maxBuffer: 5 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }
    )
    return output.trim().split('\n').filter(Boolean).length
  } catch {
    return 0
  }
}

/** Fallback: cuenta commits via GitHub API usando gh CLI */
function countGithubCommits(pattern: string, days: number): number {
  if (!PLAYER_GITHUB_REPO) return 0

  try {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
    const output = execSync(
      `gh api "/repos/${PLAYER_GITHUB_REPO}/commits?path=${encodeURIComponent(pattern)}&since=${since}&per_page=100" --jq "length"`,
      { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }
    )
    return parseInt(output.trim(), 10) || 0
  } catch {
    return 0
  }
}

async function main() {
  const { module: moduleName, days } = parseArgs(process.argv.slice(2))

  // Get file patterns: risk_map.yaml → player-risk-map.json → empty
  let filePatterns = getFilePatterns(moduleName)
  if (filePatterns.length === 0) {
    filePatterns = getFilePatternsFromJson(moduleName)
  }

  if (filePatterns.length === 0) {
    process.stderr.write(`WARN: No se encontraron file patterns para módulo "${moduleName}"\n`)
  }

  // Determine source
  const useLocal  = PLAYER_LOCAL_REPO !== '' && fs.existsSync(PLAYER_LOCAL_REPO)
  const useGithub = !useLocal && PLAYER_GITHUB_REPO !== ''

  const source: CommitFrequencyResult['source'] = useLocal ? 'local' : useGithub ? 'github-api' : 'error'

  if (!useLocal && !useGithub) {
    const output: CommitFrequencyResult = {
      module: moduleName,
      days,
      commit_count: 0,
      file_patterns: filePatterns,
      per_file: {},
      source: 'error',
      error: 'Ni PLAYER_LOCAL_REPO ni PLAYER_GITHUB_REPO están configurados en .env',
    }
    console.log(JSON.stringify(output, null, 2))
    return
  }

  process.stderr.write(`Módulo: ${moduleName} | Días: ${days} | Source: ${source}\n`)
  process.stderr.write(`Patterns: ${filePatterns.join(', ') || '(ninguno)'}\n`)

  const perFile: Record<string, number> = {}

  for (const pattern of filePatterns) {
    const count = useLocal
      ? countLocalCommits(PLAYER_LOCAL_REPO, pattern, days)
      : countGithubCommits(pattern, days)
    perFile[pattern] = count
    process.stderr.write(`  ${pattern}: ${count} commits\n`)
  }

  const commitCount = Object.values(perFile).reduce((sum, n) => sum + n, 0)

  const output: CommitFrequencyResult = {
    module:        moduleName,
    days,
    commit_count:  commitCount,
    file_patterns: filePatterns,
    per_file:      perFile,
    source,
  }

  console.log(JSON.stringify(output, null, 2))
}

main().catch(e => { console.error(JSON.stringify({ error: (e as Error).message })); process.exit(1) })
