#!/usr/bin/env ts-node
/**
 * run_playwright.ts — Ejecuta una suite Playwright y devuelve un summary JSON
 *
 * Uso:
 *   ts-node skills/run_playwright.ts
 *   ts-node skills/run_playwright.ts --spec tests/e2e/vod-playback.spec.ts
 *   ts-node skills/run_playwright.ts --spec tests/integration/ --project chromium --retries 1
 *   ts-node skills/run_playwright.ts --timeout 60000
 *
 * El reporte JSON de Playwright se escribe en playwright-report/report.json.
 * Este script siempre termina con exit 0 aunque los tests fallen — el
 * resultado se comunica via el JSON de salida.
 */

import * as path from 'path'
import * as fs from 'fs'
import { execSync, spawnSync } from 'child_process'

const REPO_ROOT   = path.resolve(__dirname, '..')
const REPORT_DIR  = path.join(REPO_ROOT, 'playwright-report')
const REPORT_FILE = path.join(REPORT_DIR, 'report.json')

interface PlaywrightResult {
  passed: number
  failed: number
  skipped: number
  duration_ms: number
  exit_code: number
  spec?: string
  project?: string
  report_path: string
}

interface PlaywrightReportSummary {
  stats?: {
    expected?: number
    skipped?: number
    unexpected?: number
    duration?: number
  }
  suites?: unknown[]
}

function parseArgs(argv: string[]): {
  spec?: string
  project: string
  retries: number
  timeout: number
} {
  const get = (flag: string) => {
    const idx = argv.indexOf(flag)
    return idx !== -1 ? argv[idx + 1] : undefined
  }

  return {
    spec:    get('--spec'),
    project: get('--project') ?? 'chromium',
    retries: parseInt(get('--retries') ?? '0', 10),
    timeout: parseInt(get('--timeout') ?? '30000', 10),
  }
}

function readReportSummary(): Partial<PlaywrightReportSummary> {
  if (!fs.existsSync(REPORT_FILE)) return {}
  try {
    return JSON.parse(fs.readFileSync(REPORT_FILE, 'utf8')) as PlaywrightReportSummary
  } catch {
    return {}
  }
}

async function main() {
  const { spec, project, retries, timeout } = parseArgs(process.argv.slice(2))

  fs.mkdirSync(REPORT_DIR, { recursive: true })

  // Construir comando Playwright
  const args: string[] = [
    'playwright', 'test',
    '--reporter=json',
    `--project=${project}`,
    `--retries=${retries}`,
    `--timeout=${timeout}`,
  ]

  if (spec) args.push(spec)

  // Redirigir JSON reporter a archivo — Playwright escribe el JSON report a
  // stdout cuando se usa --reporter=json. Lo capturamos con spawnSync.
  const startMs = Date.now()

  const result = spawnSync('npx', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
    env: {
      ...process.env,
      // Forzar JSON report a stdout (comportamiento por defecto de Playwright con --reporter=json)
      PLAYWRIGHT_JSON_OUTPUT_NAME: REPORT_FILE,
    },
  })

  const durationMs = Date.now() - startMs
  const exitCode   = result.status ?? 1

  // Playwright con --reporter=json escribe a stdout; guardarlo en report.json
  const jsonOutput = (result.stdout ?? '').trim()
  if (jsonOutput.startsWith('{') || jsonOutput.startsWith('[')) {
    try {
      // Validar que es JSON válido antes de escribir
      JSON.parse(jsonOutput)
      fs.writeFileSync(REPORT_FILE, jsonOutput, 'utf8')
    } catch {
      // No es JSON puro — puede haber mezclado con logs, intentar extraer
      const jsonStart = jsonOutput.indexOf('{')
      if (jsonStart !== -1) {
        const candidate = jsonOutput.slice(jsonStart)
        try {
          JSON.parse(candidate)
          fs.writeFileSync(REPORT_FILE, candidate, 'utf8')
        } catch { /* dejar el archivo como está */ }
      }
    }
  }

  // Leer summary del report
  const report = readReportSummary()
  const stats  = report.stats ?? {}

  const summary: PlaywrightResult = {
    passed:      stats.expected   ?? 0,
    failed:      stats.unexpected ?? 0,
    skipped:     stats.skipped    ?? 0,
    duration_ms: stats.duration   ?? durationMs,
    exit_code:   exitCode,
    spec,
    project,
    report_path: path.relative(REPO_ROOT, REPORT_FILE).replace(/\\/g, '/'),
  }

  // Si el report no tiene stats (Playwright no escribió JSON), intentar inferir
  // desde stderr (ej: "5 passed (10s)")
  if (summary.passed === 0 && summary.failed === 0) {
    const stderr = result.stderr ?? ''
    const passMatch = stderr.match(/(\d+)\s+passed/)
    const failMatch = stderr.match(/(\d+)\s+failed/)
    const skipMatch = stderr.match(/(\d+)\s+skipped/)
    if (passMatch) summary.passed  = parseInt(passMatch[1], 10)
    if (failMatch) summary.failed  = parseInt(failMatch[1], 10)
    if (skipMatch) summary.skipped = parseInt(skipMatch[1], 10)
  }

  console.log(JSON.stringify(summary, null, 2))

  // Este script siempre termina 0 — el fallo se comunica via exit_code en el JSON
}

main().catch(e => { console.error(e); process.exit(1) })
