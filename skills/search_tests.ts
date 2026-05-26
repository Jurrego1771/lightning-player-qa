#!/usr/bin/env ts-node
/**
 * search_tests.ts — Busca specs en tests/ que cubren un módulo, archivo o patrón
 *
 * Uso:
 *   ts-node skills/search_tests.ts --module ads-ima
 *   ts-node skills/search_tests.ts --file src/ads/googleIma/index.js
 *   ts-node skills/search_tests.ts --pattern "isPlayingAd|adsStarted"
 */

import * as path from 'path'
import * as fs from 'fs'
import { execSync } from 'child_process'

// js-yaml se usa para leer risk_map.yaml al buscar por módulo
// eslint-disable-next-line @typescript-eslint/no-require-imports
const yaml: { load: (s: string) => unknown } = require('js-yaml')

const REPO_ROOT     = path.resolve(__dirname, '..')
const TESTS_DIR     = path.join(REPO_ROOT, 'tests')
const RISK_MAP_PATH = path.join(REPO_ROOT, 'risk_map.yaml')

interface SpecMatch {
  spec_file: string
  test_titles: string[]
  relevance: 'direct' | 'indirect'
}

interface SearchResult {
  query: string
  matches: SpecMatch[]
}

function parseArgs(argv: string[]): {
  mode: 'module' | 'file' | 'pattern'
  value: string
} {
  for (const flag of ['--module', '--file', '--pattern'] as const) {
    const idx = argv.indexOf(flag)
    if (idx !== -1 && argv[idx + 1]) {
      return {
        mode: flag.replace('--', '') as 'module' | 'file' | 'pattern',
        value: argv[idx + 1],
      }
    }
  }
  process.stderr.write('Uso: search_tests.ts --module <nombre> | --file <path> | --pattern <regex>\n')
  process.exit(1)
}

/** Colecta todos los .spec.ts bajo tests/ recursivamente */
function collectSpecs(dir: string): string[] {
  const results: string[] = []
  if (!fs.existsSync(dir)) return results
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) results.push(...collectSpecs(full))
    else if (entry.name.endsWith('.spec.ts')) results.push(full)
  }
  return results
}

/** Extrae títulos de tests (describe + test/it) de un spec file sin ejecutarlo */
function extractTestTitles(content: string): string[] {
  const titles: string[] = []
  const testRegex = /(?:test|it|describe)\s*\(\s*['"`]([^'"`]+)['"`]/g
  let m: RegExpExecArray | null
  while ((m = testRegex.exec(content)) !== null) {
    titles.push(m[1])
  }
  return titles
}

/**
 * Construye un patrón regex para buscar por módulo.
 * Combina el nombre del módulo con rutas de archivos del player (desde risk_map.yaml si existe).
 */
function buildModulePattern(moduleName: string): string {
  const keywords: string[] = [moduleName]

  // Intentar leer archivos asociados desde risk_map.yaml
  if (fs.existsSync(RISK_MAP_PATH)) {
    try {
      const raw = fs.readFileSync(RISK_MAP_PATH, 'utf8')
      const map = yaml.load(raw) as Record<string, unknown>

      // Estructura flexible: puede ser { modules: {name: {files: [...]}}} o {name: {files: [...]}}
      let moduleData: unknown = undefined
      if (moduleName in map) moduleData = map[moduleName]
      else if (map['modules'] && typeof map['modules'] === 'object') {
        moduleData = (map['modules'] as Record<string, unknown>)[moduleName]
      }

      if (moduleData && typeof moduleData === 'object') {
        const md = moduleData as Record<string, unknown>
        if (Array.isArray(md['files'])) {
          for (const f of md['files'] as string[]) {
            keywords.push(path.basename(f, path.extname(f)))
          }
        }
        // También keywords explícitos si los hay
        if (Array.isArray(md['keywords'])) {
          keywords.push(...(md['keywords'] as string[]))
        }
      }
    } catch {
      // Si falla, continúa solo con el nombre del módulo
    }
  }

  // Escapar para regex y unir con |
  return keywords
    .map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')
}

function grepSpec(specPath: string, pattern: RegExp): { found: boolean; titles: string[] } {
  const content = fs.readFileSync(specPath, 'utf8')
  if (!pattern.test(content)) return { found: false, titles: [] }
  return { found: true, titles: extractTestTitles(content) }
}

/**
 * Determina relevancia: 'direct' si el nombre del spec o un import explícito
 * menciona el módulo/archivo, 'indirect' si solo hay keywords en el cuerpo.
 */
function detectRelevance(specPath: string, query: string, content: string): 'direct' | 'indirect' {
  const specBasename = path.basename(specPath, '.spec.ts')
  // direct: el spec se llama igual al módulo o tiene un import directo del query
  if (
    specBasename.includes(query.replace(/[/\\]/g, '-')) ||
    content.includes(`from '${query}`) ||
    content.includes(`require('${query}`)
  ) return 'direct'
  return 'indirect'
}

function runGrepSearch(query: string, mode: 'module' | 'file' | 'pattern'): SearchResult {
  const specs = collectSpecs(TESTS_DIR)
  const matches: SpecMatch[] = []

  let searchPattern: RegExp
  let displayQuery = query

  switch (mode) {
    case 'module': {
      const patternStr = buildModulePattern(query)
      searchPattern = new RegExp(patternStr, 'i')
      break
    }
    case 'file': {
      // Busca el basename del archivo (sin extensión y con extensión)
      const basename = path.basename(query)
      const basenameNoExt = path.basename(query, path.extname(query))
      searchPattern = new RegExp(
        `${basename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|${basenameNoExt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
        'i'
      )
      displayQuery = `file:${query}`
      break
    }
    case 'pattern':
      try {
        searchPattern = new RegExp(query)
      } catch (e) {
        process.stderr.write(`Patrón regex inválido: ${(e as Error).message}\n`)
        process.exit(1)
      }
      displayQuery = `pattern:${query}`
      break
  }

  for (const specPath of specs) {
    const content = fs.readFileSync(specPath, 'utf8')
    if (!searchPattern.test(content)) continue

    const relPath = path.relative(REPO_ROOT, specPath).replace(/\\/g, '/')
    const relevance = mode === 'module' || mode === 'file'
      ? detectRelevance(specPath, query, content)
      : 'indirect'

    matches.push({
      spec_file: relPath,
      test_titles: extractTestTitles(content),
      relevance,
    })
  }

  // Ordenar: direct primero
  matches.sort((a, b) => {
    if (a.relevance === b.relevance) return a.spec_file.localeCompare(b.spec_file)
    return a.relevance === 'direct' ? -1 : 1
  })

  return { query: displayQuery, matches }
}

async function main() {
  const { mode, value } = parseArgs(process.argv.slice(2))
  const result = runGrepSearch(value, mode)
  console.log(JSON.stringify(result, null, 2))
}

main().catch(e => { console.error(e); process.exit(1) })
