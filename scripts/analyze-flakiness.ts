/**
 * analyze-flakiness.ts — Calcula flakiness scores y actualiza la cuarentena
 *
 * Uso:
 *   npm run flaky:analyze              → reporte sin modificar quarantine.json
 *   npm run flaky:analyze -- --update  → reporte + actualiza quarantine.json
 *
 * Flakiness score por test:
 *   score = (flaky_runs + failed_runs) / total_runs
 *   Rango: 0.0 (nunca falla) → 1.0 (siempre falla)
 *
 * Umbrales:
 *   score > QUARANTINE_THRESHOLD  AND  total_runs >= MIN_RUNS_TO_QUARANTINE
 *   → se agrega a quarantine.json
 *
 * Cuarentena (quarantine.json):
 *   Tests en cuarentena pasan como test.fixme() — no bloquean CI pero quedan visibles.
 *   Para sacar un test de cuarentena:
 *     1. Editar quarantine.json y quitar el ID
 *     2. Commitear
 *
 * Exit codes:
 *   0 → sin tests en umbral de cuarentena (o modo solo-reporte)
 *   1 → hay tests que deberían estar en cuarentena (para CI alertas)
 */

import * as fs   from 'fs'
import * as path from 'path'

// ── Configuración ────────────────────────────────────────────────────────────

/** Score mínimo para cuarentenar (30% de runs con problemas) */
const QUARANTINE_THRESHOLD = 0.30

/** Runs mínimos observados antes de cuarentenar (evita falsos positivos en N=1) */
const MIN_RUNS_TO_QUARANTINE = 3

/** Cuántos run files analizar (los más recientes) */
const MAX_RUNS_TO_ANALYZE = 50

// ── Rutas ────────────────────────────────────────────────────────────────────

const RUNS_DIR       = path.join(process.cwd(), 'flaky-results', 'runs')
const QUARANTINE_FILE = path.join(process.cwd(), 'flaky-results', 'quarantine.json')

// ── Tipos ─────────────────────────────────────────────────────────────────────

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

interface TestStats {
  id:            string
  file:           string
  title:          string
  totalRuns:      number
  passedRuns:     number
  flakyRuns:      number
  failedRuns:     number
  skippedRuns:    number
  flakinessScore: number
  lastSeen:       string
  recentErrors:   string[]
}

interface QuarantineEntry {
  id:              string
  file:             string
  score:            number
  quarantinedAt:    string
  reason:           string
}

interface QuarantineFile {
  _info:        string
  _howto:       string
  _updated:     string
  quarantined:  QuarantineEntry[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function scoreEmoji(score: number): string {
  if (score >= QUARANTINE_THRESHOLD) return '🔴'
  if (score >= 0.10)                  return '🟡'
  return '🟢'
}

function loadRunFiles(): RunRecord[] {
  if (!fs.existsSync(RUNS_DIR)) {
    console.error(`\n❌  No se encontró ${RUNS_DIR}`)
    console.error('   Corre primero: npm test (el FlakinessReporter genera los archivos)\n')
    process.exit(1)
  }

  const files = fs.readdirSync(RUNS_DIR)
    .filter(f => f.endsWith('.json'))
    .sort()
    .slice(-MAX_RUNS_TO_ANALYZE)

  if (files.length === 0) {
    console.error(`\n❌  No hay archivos de run en ${RUNS_DIR}`)
    console.error('   Corre primero: npm test\n')
    process.exit(1)
  }

  return files.map(f => {
    const content = fs.readFileSync(path.join(RUNS_DIR, f), 'utf-8')
    return JSON.parse(content) as RunRecord
  })
}

function aggregateStats(runs: RunRecord[]): Map<string, TestStats> {
  const stats = new Map<string, TestStats>()

  for (const run of runs) {
    for (const test of run.tests) {
      if (test.status === 'skipped') continue  // no contar skips

      const existing = stats.get(test.id)
      if (!existing) {
        stats.set(test.id, {
          id:            test.id,
          file:           test.file,
          title:          test.title,
          totalRuns:      1,
          passedRuns:     test.status === 'passed' ? 1 : 0,
          flakyRuns:      test.status === 'flaky'  ? 1 : 0,
          failedRuns:     test.status === 'failed' ? 1 : 0,
          skippedRuns:    0,
          flakinessScore: 0,
          lastSeen:       run.timestamp,
          recentErrors:   test.errors.slice(0, 2),
        })
      } else {
        existing.totalRuns++
        if (test.status === 'passed') existing.passedRuns++
        if (test.status === 'flaky')  existing.flakyRuns++
        if (test.status === 'failed') existing.failedRuns++
        if (run.timestamp > existing.lastSeen) {
          existing.lastSeen    = run.timestamp
          existing.recentErrors = test.errors.slice(0, 2)
        }
      }
    }
  }

  // Calcular score final
  for (const [, stat] of stats) {
    stat.flakinessScore = (stat.flakyRuns + stat.failedRuns) / stat.totalRuns
  }

  return stats
}

function loadQuarantine(): QuarantineFile {
  if (!fs.existsSync(QUARANTINE_FILE)) {
    return {
      _info:       'Lista de tests en cuarentena. Actualizar con: npm run flaky:update-quarantine',
      _howto:      'Tests aquí se marcan como fixme() — no bloquean CI. Para sacar: eliminar la entrada y commitear.',
      _updated:    new Date().toISOString(),
      quarantined: [],
    }
  }
  return JSON.parse(fs.readFileSync(QUARANTINE_FILE, 'utf-8'))
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main(): void {
  const shouldUpdate = process.argv.includes('--update')
  const runs = loadRunFiles()
  const stats = aggregateStats(runs)
  const quarantine = loadQuarantine()
  const quarantinedIds = new Set(quarantine.quarantined.map(q => q.id))

  // Separar por categorías
  const criticalStats: TestStats[] = []  // supera umbral, aún no cuarentenado
  const warningStats:  TestStats[] = []  // entre 10% y umbral
  const okStats:       TestStats[] = []  // sin problemas
  const alreadyQuarantined: TestStats[] = []

  for (const [, stat] of stats) {
    if (quarantinedIds.has(stat.id)) {
      alreadyQuarantined.push(stat)
    } else if (stat.flakinessScore >= QUARANTINE_THRESHOLD && stat.totalRuns >= MIN_RUNS_TO_QUARANTINE) {
      criticalStats.push(stat)
    } else if (stat.flakinessScore >= 0.10) {
      warningStats.push(stat)
    } else {
      okStats.push(stat)
    }
  }

  // Ordenar por score descendente
  criticalStats.sort((a, b) => b.flakinessScore - a.flakinessScore)
  warningStats.sort((a, b) => b.flakinessScore - a.flakinessScore)

  // ── Reporte ────────────────────────────────────────────────────────────────

  console.log('\n══════════════════════════════════════════════════════════════')
  console.log('  Flakiness Analysis — Lightning Player QA')
  console.log('══════════════════════════════════════════════════════════════')
  console.log(`  Runs analizados:  ${runs.length} (últimos ${MAX_RUNS_TO_ANALYZE} máx.)`)
  console.log(`  Tests únicos:     ${stats.size}`)
  console.log(`  En cuarentena:    ${quarantine.quarantined.length}`)
  console.log(`  Umbral:           score > ${pct(QUARANTINE_THRESHOLD)} con ≥${MIN_RUNS_TO_QUARANTINE} runs`)
  console.log('══════════════════════════════════════════════════════════════\n')

  if (criticalStats.length > 0) {
    console.log('🔴  REQUIEREN CUARENTENA:\n')
    for (const s of criticalStats) {
      console.log(`  ${s.id}`)
      console.log(`    Score: ${pct(s.flakinessScore)}  (${s.flakyRuns} flaky + ${s.failedRuns} failed / ${s.totalRuns} runs)`)
      if (s.recentErrors.length > 0) {
        console.log(`    Último error: ${s.recentErrors[0].split('\n')[0]}`)
      }
      console.log()
    }
  }

  if (warningStats.length > 0) {
    console.log('🟡  ADVERTENCIA (monitorear):\n')
    for (const s of warningStats) {
      console.log(`  ${scoreEmoji(s.flakinessScore)}  ${s.id}`)
      console.log(`     Score: ${pct(s.flakinessScore)}  (${s.flakyRuns} flaky + ${s.failedRuns} failed / ${s.totalRuns} runs)`)
    }
    console.log()
  }

  if (alreadyQuarantined.length > 0) {
    console.log('🔒  EN CUARENTENA:\n')
    for (const q of quarantine.quarantined) {
      const s = stats.get(q.id)
      if (s) {
        const scoreLine = `score actual: ${pct(s.flakinessScore)} (${s.totalRuns} runs)`
        console.log(`  · ${q.id}`)
        console.log(`    ${scoreLine}  — cuarentenado: ${q.quarantinedAt.slice(0, 10)}`)
      } else {
        console.log(`  · ${q.id}  (sin datos en runs analizados)`)
      }
    }
    console.log()
  }

  if (okStats.length > 0) {
    const sample = okStats.slice(0, 5)
    console.log(`🟢  SIN PROBLEMAS: ${okStats.length} tests`)
    if (okStats.length <= 10) {
      for (const s of okStats) {
        console.log(`  · ${s.id}  (${pct(s.flakinessScore)})`)
      }
    } else {
      for (const s of sample) {
        console.log(`  · ${s.id}  (${pct(s.flakinessScore)})`)
      }
      console.log(`  ... y ${okStats.length - sample.length} más`)
    }
    console.log()
  }

  console.log('══════════════════════════════════════════════════════════════')

  // ── Actualizar cuarentena ─────────────────────────────────────────────────

  if (shouldUpdate && criticalStats.length > 0) {
    const newEntries: QuarantineEntry[] = criticalStats.map(s => ({
      id:           s.id,
      file:          s.file,
      score:         parseFloat(s.flakinessScore.toFixed(3)),
      quarantinedAt: new Date().toISOString(),
      reason:        `Flakiness score ${pct(s.flakinessScore)} en ${s.totalRuns} runs (umbral: ${pct(QUARANTINE_THRESHOLD)})`,
    }))

    // Merge: preservar entradas existentes, agregar nuevas
    const existingIds = new Set(quarantine.quarantined.map(q => q.id))
    const toAdd = newEntries.filter(e => !existingIds.has(e.id))

    quarantine.quarantined.push(...toAdd)
    quarantine._updated = new Date().toISOString()

    fs.writeFileSync(QUARANTINE_FILE, JSON.stringify(quarantine, null, 2))

    console.log(`\n✅  quarantine.json actualizado — ${toAdd.length} test(s) agregado(s)`)
    console.log('   Próximo paso:')
    console.log('     git add flaky-results/quarantine.json')
    console.log('     git commit -m "test: quarantine flaky tests"\n')
  } else if (shouldUpdate && criticalStats.length === 0) {
    console.log('\n✅  Sin tests nuevos para cuarentenar\n')
  } else if (criticalStats.length > 0) {
    console.log(`\n⚠   ${criticalStats.length} test(s) superan el umbral`)
    console.log('   Para cuarentenar: npm run flaky:update-quarantine\n')
    process.exit(1)  // fail en CI para que se note
  } else {
    console.log('\n✅  Sin tests en umbral de cuarentena\n')
  }
}

main()
