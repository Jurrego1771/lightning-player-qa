/**
 * compare-perf.ts — Compara las métricas del run actual contra el baseline
 *
 * Uso:
 *   npm run perf:compare
 *
 * Salida:
 *   - Lista de métricas con su delta vs baseline
 *   - REGRESION: si alguna métrica empeoró más de REGRESSION_THRESHOLD
 *   - MEJORA:    si alguna métrica mejoró más de IMPROVEMENT_THRESHOLD
 *   - NUEVO:     métricas sin baseline aún (no falla el run)
 *
 * Exit codes:
 *   0 → sin regresiones (o baseline vacío — primera ejecución)
 *   1 → al menos una regresión detectada
 *
 * Cuándo correr:
 *   - Manualmente después de npm run test:performance
 *   - Automáticamente en CI después del job de performance
 */

import * as fs   from 'fs'
import * as path from 'path'

// ── Configuración ─────────────────────────────────────────────────────────

/** Métricas donde MAYOR valor = PEOR (ej: latencias, ratios de error) */
const HIGHER_IS_WORSE = new Set([
  'timeToFirstFrame_ms',
  'timeToLoadedMetadata_ms',
  'timeToCanPlay_ms',
  'seekLatency_ms',
  'bufferingRatio',
  'droppedFrameRatio',
])

/** Métricas donde MENOR valor = PEOR (ej: buffer acumulado) */
const LOWER_IS_WORSE = new Set([
  'bufferedAhead_sec',
])

/** Porcentaje de degradación relativa que dispara una regresión */
const REGRESSION_THRESHOLD  = 0.20   // 20%

/** Porcentaje de mejora relativa que se reporta como mejora notable */
const IMPROVEMENT_THRESHOLD = 0.10   // 10%

// ── Rutas ─────────────────────────────────────────────────────────────────

const BASELINE_FILE = path.join(process.cwd(), 'performance-baseline', 'metrics.json')
const RESULTS_FILE  = path.join(process.cwd(), 'perf-results', 'current-run.json')

// ── Helpers ───────────────────────────────────────────────────────────────

function fmt(value: number, unit: string): string {
  if (unit === 'ms') return `${value.toFixed(0)}ms`
  if (unit === 'ratio') return `${(value * 100).toFixed(3)}%`
  if (unit === 'sec') return `${value.toFixed(2)}s`
  return String(value)
}

function unitOf(metricName: string): string {
  if (metricName.endsWith('_ms'))    return 'ms'
  if (metricName.endsWith('Ratio'))  return 'ratio'
  if (metricName.endsWith('_sec'))   return 'sec'
  return ''
}

function pct(delta: number): string {
  return `${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)}%`
}

// ── Main ──────────────────────────────────────────────────────────────────

function main(): void {
  // Verificar que existe el resultado del run actual
  if (!fs.existsSync(RESULTS_FILE)) {
    console.error(`\n❌  No se encontró ${RESULTS_FILE}`)
    console.error('   Corre primero: npm run test:performance\n')
    process.exit(1)
  }

  const current  = JSON.parse(fs.readFileSync(RESULTS_FILE,  'utf-8'))
  const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf-8'))

  const baselineMetrics: Record<string, Record<string, number>> = baseline.metrics ?? {}
  const currentMetrics:  Record<string, Record<string, number>> = current.metrics  ?? {}

  const isFirstRun = Object.keys(baselineMetrics).length === 0

  console.log('\n══════════════════════════════════════════════════════')
  console.log('  Performance Comparison — Lightning Player QA')
  console.log('══════════════════════════════════════════════════════')
  console.log(`  Run:      ${current.timestamp}`)
  console.log(`  Player:   ${current.playerVersion}`)
  console.log(`  Env:      ${current.environment} / ${current.browser}`)
  if (!isFirstRun) {
    console.log(`  Baseline: ${baseline._updated ?? '(sin fecha)'} — Player ${baseline._playerVersion ?? 'unknown'}`)
  } else {
    console.log('  Baseline: ⚠  sin baseline — primera ejecución')
  }
  console.log('══════════════════════════════════════════════════════\n')

  if (isFirstRun) {
    console.log('  Primera ejecución detectada. No hay baseline con qué comparar.')
    console.log('  Corre npm run perf:update-baseline para establecer el baseline.\n')
    printCurrentMetrics(currentMetrics)
    process.exit(0)
  }

  // ── Comparación ───────────────────────────────────────────────────────

  const regressions: string[]  = []
  const improvements: string[] = []
  const unchanged:   string[]  = []
  const newMetrics:  string[]  = []

  for (const [key, currentValues] of Object.entries(currentMetrics)) {
    const baselineValues = baselineMetrics[key]

    if (!baselineValues) {
      newMetrics.push(`  NEW  ${key}: ${JSON.stringify(currentValues)}`)
      continue
    }

    for (const [metric, currentValue] of Object.entries(currentValues)) {
      const baselineValue = baselineValues[metric]
      if (baselineValue === undefined || baselineValue === null) {
        newMetrics.push(`  NEW  ${key}.${metric}: ${fmt(currentValue, unitOf(metric))}`)
        continue
      }

      const delta = (currentValue - baselineValue) / baselineValue
      const unit  = unitOf(metric)
      const label = `${key}.${metric}`
      const line  = `  ${label}: ${fmt(baselineValue, unit)} → ${fmt(currentValue, unit)} (${pct(delta)})`

      // Determinar si es regresión, mejora o sin cambio
      const isRegression = HIGHER_IS_WORSE.has(metric)
        ? delta > REGRESSION_THRESHOLD
        : LOWER_IS_WORSE.has(metric)
          ? delta < -REGRESSION_THRESHOLD
          : false

      const isImprovement = HIGHER_IS_WORSE.has(metric)
        ? delta < -IMPROVEMENT_THRESHOLD
        : LOWER_IS_WORSE.has(metric)
          ? delta > IMPROVEMENT_THRESHOLD
          : false

      if (isRegression) {
        regressions.push(`  ❌  REGRESION  ${line.trim()}`)
      } else if (isImprovement) {
        improvements.push(`  ✅  MEJORA     ${line.trim()}`)
      } else {
        unchanged.push(`  ·   OK         ${line.trim()}`)
      }
    }
  }

  // ── Reporte ───────────────────────────────────────────────────────────

  if (regressions.length > 0) {
    console.log('REGRESIONES DETECTADAS:\n')
    regressions.forEach(r => console.log(r))
    console.log()
  }

  if (improvements.length > 0) {
    console.log('Mejoras notables:\n')
    improvements.forEach(i => console.log(i))
    console.log()
  }

  if (unchanged.length > 0) {
    console.log('Sin cambio significativo:\n')
    unchanged.forEach(u => console.log(u))
    console.log()
  }

  if (newMetrics.length > 0) {
    console.log('Métricas nuevas (sin baseline aún):\n')
    newMetrics.forEach(n => console.log(n))
    console.log()
  }

  console.log('══════════════════════════════════════════════════════')

  if (regressions.length > 0) {
    console.log(`\n❌  ${regressions.length} regresión(es) detectada(s)`)
    console.log('   Si el cambio es intencional: npm run perf:update-baseline\n')
    process.exit(1)
  }

  console.log(`\n✅  Sin regresiones. Threshold: ${REGRESSION_THRESHOLD * 100}% relativo`)
  if (improvements.length > 0) {
    console.log(`   ${improvements.length} mejora(s) detectada(s) — considera actualizar el baseline`)
    console.log('   npm run perf:update-baseline\n')
  } else {
    console.log()
  }

  process.exit(0)
}

function printCurrentMetrics(metrics: Record<string, Record<string, number>>): void {
  console.log('Métricas del run actual:\n')
  for (const [key, values] of Object.entries(metrics)) {
    console.log(`  ${key}:`)
    for (const [metric, value] of Object.entries(values)) {
      console.log(`    ${metric}: ${fmt(value, unitOf(metric))}`)
    }
  }
  console.log()
}

main()
