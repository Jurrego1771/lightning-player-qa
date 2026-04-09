/**
 * reporters/flakiness-reporter.ts — Reporter de Playwright para detección de flakiness
 *
 * Registra el resultado de cada test (passed, failed, flaky) en un archivo JSON
 * por run. "Flaky" = falló en algún intento pero pasó en el último (retry).
 *
 * Output: flaky-results/runs/TIMESTAMP.json
 *
 * Uso posterior:
 *   npm run flaky:analyze           → calcula scores y genera reporte
 *   npm run flaky:update-quarantine → actualiza quarantine.json y hace fixme en CI
 *
 * Formato del archivo de run:
 * {
 *   "timestamp": "2026-04-08T...",
 *   "totalTests": 42,
 *   "tests": [
 *     {
 *       "id": "tests/e2e/vod-playback.spec.ts > VOD > carga y reproduce",
 *       "file": "tests/e2e/vod-playback.spec.ts",
 *       "title": "carga y reproduce",
 *       "status": "flaky",       // "passed" | "failed" | "flaky" | "skipped"
 *       "attempts": 2,
 *       "errors": ["Error: expect(received)..."]
 *     }
 *   ]
 * }
 */

import type {
  Reporter,
  TestCase,
  TestResult,
  FullResult,
} from '@playwright/test/reporter'
import * as fs   from 'fs'
import * as path from 'path'

const RUNS_DIR = path.join(process.cwd(), 'flaky-results', 'runs')

interface TestRecord {
  id:       string
  file:     string
  title:    string
  project:  string
  status:   'passed' | 'failed' | 'flaky' | 'skipped'
  attempts: number
  errors:   string[]
}

interface RunRecord {
  timestamp:  string
  totalTests: number
  tests:      TestRecord[]
}

export class FlakinessReporter implements Reporter {
  private records: TestRecord[] = []
  private startTime = new Date().toISOString()

  onTestEnd(test: TestCase, result: TestResult): void {
    // Determinar status consolidado
    // Playwright en resultado final: 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted'
    // "Flaky" no es un status nativo — lo detectamos: hay retries Y el último pasó
    const allResults   = test.results
    const attempts     = allResults.length
    const finalStatus  = result.status

    let consolidatedStatus: TestRecord['status']

    if (finalStatus === 'skipped') {
      consolidatedStatus = 'skipped'
    } else if (finalStatus === 'passed' && attempts > 1) {
      // Pasó, pero necesitó retries — eso es flaky
      consolidatedStatus = 'flaky'
    } else if (finalStatus === 'passed') {
      consolidatedStatus = 'passed'
    } else {
      // failed | timedOut | interrupted → failed
      consolidatedStatus = 'failed'
    }

    // Recopilar errores de todos los intentos fallidos
    const errors: string[] = []
    for (const r of allResults) {
      if (r.status !== 'passed' && r.status !== 'skipped') {
        for (const e of r.errors) {
          const msg = e.message ?? String(e)
          // Truncar a 300 chars — suficiente para identificar el problema
          errors.push(msg.slice(0, 300))
        }
      }
    }

    // ID estable: ruta del spec + título completo (incluyendo describe anidados)
    const titlePath = test.titlePath()
    // titlePath[0] es el archivo, el resto son los describe/test names
    const id = titlePath.join(' > ')

    this.records.push({
      id,
      file:     test.location.file.replace(process.cwd() + path.sep, '').replace(/\\/g, '/'),
      title:    test.title,
      project:  test.parent?.project()?.name ?? 'unknown',
      status:   consolidatedStatus,
      attempts,
      errors:   [...new Set(errors)],  // deduplicar errores iguales de reintentos
    })
  }

  onEnd(_result: FullResult): void {
    // Crear directorio si no existe
    fs.mkdirSync(RUNS_DIR, { recursive: true })

    const run: RunRecord = {
      timestamp:  this.startTime,
      totalTests: this.records.length,
      tests:      this.records,
    }

    const filename = `${this.startTime.replace(/[:.]/g, '-')}.json`
    const filepath = path.join(RUNS_DIR, filename)
    fs.writeFileSync(filepath, JSON.stringify(run, null, 2))

    // Resumen en consola (solo si hay flaky/failed)
    const flaky  = this.records.filter(r => r.status === 'flaky')
    const failed = this.records.filter(r => r.status === 'failed')

    if (flaky.length > 0 || failed.length > 0) {
      console.log('\n──────────────────────────────────────────')
      console.log('  Flakiness Reporter')
      console.log('──────────────────────────────────────────')
      if (flaky.length > 0) {
        console.log(`  ⚠  ${flaky.length} test(s) FLAKY (pasaron con retry):`)
        flaky.forEach(t => console.log(`     · ${t.id} [${t.project}]`))
      }
      if (failed.length > 0) {
        console.log(`  ❌  ${failed.length} test(s) FALLARON (sin recovery):`)
        failed.forEach(t => console.log(`     · ${t.id} [${t.project}]`))
      }
      console.log(`\n  Run guardado en: ${filepath}`)
      console.log('  Analizar con: npm run flaky:analyze')
      console.log('──────────────────────────────────────────\n')
    } else {
      console.log(`\n  ✅  Flakiness Reporter: ${this.records.length} tests — 0 flaky, 0 failed`)
      console.log(`  Run guardado en: ${filepath}\n`)
    }
  }
}

export default FlakinessReporter
