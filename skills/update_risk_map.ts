#!/usr/bin/env ts-node
/**
 * update_risk_map.ts — Actualiza valores de un módulo en risk_map.yaml
 *
 * Uso:
 *   ts-node skills/update_risk_map.ts --module ads-ima --score 0.75 --signals '{"commit_frequency_90d":12,"bugs_closed_90d":3}'
 *   ts-node skills/update_risk_map.ts --module hls --score 0.9
 */

import * as path from 'path'
import * as fs from 'fs'
import * as dotenv from 'dotenv'

dotenv.config({ path: path.resolve(__dirname, '../.env') })

// eslint-disable-next-line @typescript-eslint/no-require-imports
const yaml: { load: (s: string) => unknown; dump: (obj: unknown, opts?: object) => string } = require('js-yaml')

const REPO_ROOT      = path.resolve(__dirname, '..')
const RISK_MAP_PATH  = path.join(REPO_ROOT, 'risk_map.yaml')

type RiskLabel = 'critical' | 'high' | 'medium' | 'low'

interface UpdateRiskMapResult {
  module:     string
  old_score:  number | null
  new_score:  number
  risk_label: RiskLabel
  delta:      number
  error?:     string
}

function parseArgs(argv: string[]): { module: string; score: number; signals: Record<string, unknown> } {
  let moduleName = ''
  let score      = -1
  let signals: Record<string, unknown> = {}

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--module'  && argv[i + 1]) { moduleName = argv[++i]; continue }
    if (argv[i] === '--score'   && argv[i + 1]) { score = parseFloat(argv[++i]); continue }
    if (argv[i] === '--signals' && argv[i + 1]) {
      try {
        signals = JSON.parse(argv[++i]) as Record<string, unknown>
      } catch (err) {
        process.stderr.write(`ERROR: --signals no es JSON válido: ${(err as Error).message}\n`)
        process.exit(1)
      }
      continue
    }
  }

  if (!moduleName) {
    process.stderr.write('ERROR: --module es requerido\n')
    process.exit(1)
  }
  if (score < 0 || score > 1) {
    process.stderr.write('ERROR: --score es requerido y debe ser un número entre 0.0 y 1.0\n')
    process.exit(1)
  }

  return { module: moduleName, score, signals }
}

function scoreToLabel(score: number): RiskLabel {
  if (score >= 0.8) return 'critical'
  if (score >= 0.6) return 'high'
  if (score >= 0.3) return 'medium'
  return 'low'
}

/** Load or create a default risk_map.yaml structure */
function loadOrCreateRiskMap(): Record<string, unknown> {
  if (!fs.existsSync(RISK_MAP_PATH)) {
    process.stderr.write(`WARN: risk_map.yaml no existe — creando nuevo en ${RISK_MAP_PATH}\n`)
    return {
      version:      '1.0',
      last_updated: new Date().toISOString().slice(0, 10),
      description:  'Mapa de riesgo del Lightning Player por módulo',
      modules:      {},
    }
  }

  try {
    const parsed = yaml.load(fs.readFileSync(RISK_MAP_PATH, 'utf8'))
    if (!parsed || typeof parsed !== 'object') {
      return { version: '1.0', modules: {} }
    }
    return parsed as Record<string, unknown>
  } catch (err) {
    process.stderr.write(`ERROR: No se pudo parsear risk_map.yaml: ${(err as Error).message}\n`)
    process.exit(1)
  }
}

async function main() {
  const { module: moduleName, score: newScore, signals } = parseArgs(process.argv.slice(2))

  const riskMap = loadOrCreateRiskMap()

  // Normalize structure: support both { modules: {...} } and flat { [name]: {...} }
  let modules: Record<string, unknown>

  if (riskMap['modules'] && typeof riskMap['modules'] === 'object') {
    modules = riskMap['modules'] as Record<string, unknown>
  } else {
    // Flat structure: treat the whole map as modules (excluding meta keys)
    modules = riskMap
  }

  // Read existing module data (preserves other fields)
  const existing = (modules[moduleName] ?? {}) as Record<string, unknown>
  const oldScore: number | null = typeof existing['score'] === 'number' ? existing['score'] : null

  const newLabel = scoreToLabel(newScore)
  const now      = new Date().toISOString()

  // Build updated module entry — preserve existing fields, update score + meta
  const updatedModule: Record<string, unknown> = {
    ...existing,
    score:      Math.round(newScore * 1000) / 1000,
    risk_label: newLabel,
  }

  // Merge signals
  if (Object.keys(signals).length > 0) {
    const existingSignals = (existing['signals'] ?? {}) as Record<string, unknown>
    updatedModule['signals'] = { ...existingSignals, ...signals }
  }

  // Update meta
  const existingMeta = (existing['meta'] ?? {}) as Record<string, unknown>
  updatedModule['meta'] = {
    ...existingMeta,
    last_updated: now,
    updated_by:   'risk-calibrator',
  }

  // Write back to map
  if (riskMap['modules'] && typeof riskMap['modules'] === 'object') {
    (riskMap['modules'] as Record<string, unknown>)[moduleName] = updatedModule
  } else {
    riskMap[moduleName] = updatedModule
  }

  // Update top-level meta
  riskMap['last_updated'] = now

  // Serialize and write
  try {
    const yamlStr = yaml.dump(riskMap, {
      indent:    2,
      lineWidth: 120,
      noRefs:    true,
      sortKeys:  false,
    })
    fs.writeFileSync(RISK_MAP_PATH, yamlStr, 'utf8')
  } catch (err) {
    const output: UpdateRiskMapResult = {
      module:     moduleName,
      old_score:  oldScore,
      new_score:  newScore,
      risk_label: newLabel,
      delta:      oldScore !== null ? Math.round((newScore - oldScore) * 1000) / 1000 : newScore,
      error:      `Error escribiendo risk_map.yaml: ${(err as Error).message}`,
    }
    console.log(JSON.stringify(output, null, 2))
    process.exit(1)
  }

  const delta = oldScore !== null ? Math.round((newScore - oldScore) * 1000) / 1000 : newScore

  process.stderr.write(`Módulo "${moduleName}" actualizado\n`)
  process.stderr.write(`  Score: ${oldScore ?? '(nuevo)'} → ${newScore} (${delta >= 0 ? '+' : ''}${delta})\n`)
  process.stderr.write(`  Risk label: ${newLabel}\n`)

  const output: UpdateRiskMapResult = {
    module:     moduleName,
    old_score:  oldScore,
    new_score:  newScore,
    risk_label: newLabel,
    delta,
  }

  console.log(JSON.stringify(output, null, 2))
}

main().catch(e => { console.error(JSON.stringify({ error: (e as Error).message })); process.exit(1) })
