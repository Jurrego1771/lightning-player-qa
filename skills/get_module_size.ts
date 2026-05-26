#!/usr/bin/env ts-node
/**
 * get_module_size.ts — Cuenta archivos y líneas de código de un módulo del player
 *
 * Uso:
 *   ts-node skills/get_module_size.ts --module ads-ima
 *   ts-node skills/get_module_size.ts --module hls
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
const PLAYER_LOCAL_REPO  = process.env.PLAYER_LOCAL_REPO ?? ''

interface FileEntry {
  path: string
  loc:  number
}

interface ModuleSizeResult {
  module:     string
  file_count: number
  total_loc:  number
  files:      FileEntry[]
  error?:     string
}

function parseArgs(argv: string[]): { module: string } {
  let moduleName = ''
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--module' && argv[i + 1]) { moduleName = argv[++i]; break }
  }
  if (!moduleName) {
    process.stderr.write('ERROR: --module es requerido\n')
    process.exit(1)
  }
  return { module: moduleName }
}

/** Obtiene file patterns del módulo desde risk_map.yaml o player-risk-map.json */
function getFilePatterns(moduleName: string): string[] {
  // Try risk_map.yaml
  if (fs.existsSync(RISK_MAP_PATH)) {
    try {
      const parsed = yaml.load(fs.readFileSync(RISK_MAP_PATH, 'utf8')) as Record<string, unknown> | null
      if (parsed && typeof parsed === 'object') {
        let data: Record<string, unknown> | undefined

        if (moduleName in parsed) {
          data = parsed[moduleName] as Record<string, unknown>
        } else if (parsed['modules'] && typeof parsed['modules'] === 'object') {
          const mods = parsed['modules'] as Record<string, unknown>
          if (moduleName in mods) data = mods[moduleName] as Record<string, unknown>
        }

        if (data) {
          const patterns = (data['file_patterns'] ?? data['key_files'] ?? []) as string[]
          if (patterns.length > 0) return patterns
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
      return map.features?.[moduleName]?.key_files ?? []
    } catch { /* ignore */ }
  }

  return []
}

/**
 * Counts lines in a file. Cross-platform: reads the file directly.
 * Falls back to 0 on error.
 */
function countLines(filePath: string): number {
  try {
    const content = fs.readFileSync(filePath, 'utf8')
    // Count actual non-empty lines
    return content.split('\n').length
  } catch {
    return 0
  }
}

/**
 * Resolves a pattern to concrete file paths under the player repo.
 * Patterns can be:
 *   - "src/ads/googleIma/handler.js"  → single file
 *   - "src/ads/googleIma/"             → directory (glob all .js/.jsx/.ts)
 *   - "src/view/video/"                → directory
 */
function resolvePattern(repoPath: string, pattern: string): string[] {
  const fullPath = path.join(repoPath, pattern)

  // Direct file
  if (!pattern.endsWith('/') && fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
    return [fullPath]
  }

  // Directory — list recursively
  const dirPath = pattern.endsWith('/') ? fullPath : fullPath
  if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
    return walkDir(dirPath, ['.js', '.jsx', '.ts', '.tsx'])
  }

  // Pattern without trailing slash that is a directory
  if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
    return walkDir(fullPath, ['.js', '.jsx', '.ts', '.tsx'])
  }

  // Try as glob via git ls-files (most reliable cross-platform)
  try {
    const output = execSync(
      `git -C "${repoPath}" ls-files -- "${pattern}"`,
      { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }
    )
    return output.trim().split('\n').filter(Boolean).map(f => path.join(repoPath, f))
  } catch {
    return []
  }
}

function walkDir(dir: string, exts: string[]): string[] {
  const results: string[] = []
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        results.push(...walkDir(full, exts))
      } else if (exts.some(e => entry.name.endsWith(e))) {
        results.push(full)
      }
    }
  } catch { /* ignore permission errors */ }
  return results
}

async function main() {
  const { module: moduleName } = parseArgs(process.argv.slice(2))

  const filePatterns = getFilePatterns(moduleName)
  process.stderr.write(`Módulo: ${moduleName} | Patterns: ${filePatterns.join(', ') || '(ninguno)'}\n`)

  // Soft-fail if PLAYER_LOCAL_REPO not accessible
  if (!PLAYER_LOCAL_REPO || !fs.existsSync(PLAYER_LOCAL_REPO)) {
    const output: ModuleSizeResult = {
      module:     moduleName,
      file_count: 0,
      total_loc:  0,
      files:      [],
      error:      PLAYER_LOCAL_REPO
        ? `PLAYER_LOCAL_REPO no accesible: ${PLAYER_LOCAL_REPO}`
        : 'PLAYER_LOCAL_REPO no configurado en .env',
    }
    console.log(JSON.stringify(output, null, 2))
    return  // exit 0 — not a critical error
  }

  // Resolve all file patterns to concrete files
  const allFiles = new Set<string>()
  for (const pattern of filePatterns) {
    const resolved = resolvePattern(PLAYER_LOCAL_REPO, pattern)
    resolved.forEach(f => allFiles.add(f))
  }

  // If no patterns, try to resolve the module as a directory path
  if (filePatterns.length === 0) {
    const guessedDir = path.join(PLAYER_LOCAL_REPO, 'src', moduleName)
    if (fs.existsSync(guessedDir)) {
      walkDir(guessedDir, ['.js', '.jsx', '.ts', '.tsx']).forEach(f => allFiles.add(f))
    }
  }

  process.stderr.write(`Archivos encontrados: ${allFiles.size}\n`)

  // Count LOC per file
  const files: FileEntry[] = []
  for (const filePath of Array.from(allFiles).sort()) {
    const loc = countLines(filePath)
    const relativePath = path.relative(PLAYER_LOCAL_REPO, filePath).replace(/\\/g, '/')
    files.push({ path: relativePath, loc })
    process.stderr.write(`  ${relativePath}: ${loc} LOC\n`)
  }

  const totalLoc = files.reduce((sum, f) => sum + f.loc, 0)

  const output: ModuleSizeResult = {
    module:     moduleName,
    file_count: files.length,
    total_loc:  totalLoc,
    files,
  }

  console.log(JSON.stringify(output, null, 2))
}

main().catch(e => { console.error(JSON.stringify({ error: (e as Error).message })); process.exit(1) })
