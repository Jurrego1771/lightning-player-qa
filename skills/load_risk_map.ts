#!/usr/bin/env ts-node
/**
 * load_risk_map.ts — Lee y parsea risk_map.yaml desde la raíz del proyecto
 *
 * Uso:
 *   ts-node skills/load_risk_map.ts                    → mapa completo como JSON
 *   ts-node skills/load_risk_map.ts --module ads-ima   → solo ese módulo
 */

import * as path from 'path'
import * as fs from 'fs'

// js-yaml se carga con require para compatibilidad con ts-node + esModuleInterop
// eslint-disable-next-line @typescript-eslint/no-require-imports
const yaml: { load: (s: string) => unknown } = require('js-yaml')

const REPO_ROOT     = path.resolve(__dirname, '..')
const RISK_MAP_PATH = path.join(REPO_ROOT, 'risk_map.yaml')

function die(msg: string): never {
  process.stderr.write(`ERROR: ${msg}\n`)
  process.exit(1)
}

function parseArgs(argv: string[]): { module?: string } {
  const idx = argv.indexOf('--module')
  if (idx !== -1 && argv[idx + 1]) return { module: argv[idx + 1] }
  return {}
}

async function main() {
  const { module: moduleName } = parseArgs(process.argv.slice(2))

  if (!fs.existsSync(RISK_MAP_PATH)) {
    die(`risk_map.yaml no encontrado en: ${RISK_MAP_PATH}`)
  }

  let parsed: unknown
  try {
    const raw = fs.readFileSync(RISK_MAP_PATH, 'utf8')
    parsed = yaml.load(raw)
  } catch (err) {
    die(`No se pudo parsear risk_map.yaml: ${(err as Error).message}`)
  }

  if (parsed === null || typeof parsed !== 'object') {
    die('risk_map.yaml está vacío o no es un objeto válido')
  }

  if (!moduleName) {
    console.log(JSON.stringify(parsed, null, 2))
    return
  }

  // Busca el módulo en cualquier nivel del mapa. Estructura esperada:
  // { modules: { [name]: {...} } }  OR  { [name]: {...} }
  const map = parsed as Record<string, unknown>

  let moduleData: unknown = undefined

  // Nivel directo
  if (moduleName in map) {
    moduleData = map[moduleName]
  } else if (map['modules'] && typeof map['modules'] === 'object') {
    const modules = map['modules'] as Record<string, unknown>
    if (moduleName in modules) moduleData = modules[moduleName]
  }

  if (moduleData === undefined) {
    // Devuelve vacío con error en stderr, pero sin exit 1 (módulo puede simplemente no estar)
    process.stderr.write(`WARN: Módulo "${moduleName}" no encontrado en risk_map.yaml\n`)
    console.log(JSON.stringify({ module: moduleName, found: false }, null, 2))
    return
  }

  console.log(JSON.stringify({ module: moduleName, found: true, data: moduleData }, null, 2))
}

main().catch(e => { console.error(e); process.exit(1) })

// DEPS: npm install js-yaml @types/js-yaml
