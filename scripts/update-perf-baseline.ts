/**
 * update-perf-baseline.ts — Actualiza el baseline de performance
 *
 * Copia las métricas del run actual (perf-results/current-run.json)
 * al baseline commiteado (performance-baseline/metrics.json).
 *
 * Uso:
 *   npm run perf:update-baseline
 *
 * Cuándo correr:
 *   - Después de un run limpio en condiciones normales (primera vez)
 *   - Cuando una regresión es intencional (nueva feature más costosa, refactor)
 *   - Cuando se detecta una mejora significativa y se quiere capturarla
 *
 * Después de correr este script:
 *   git add performance-baseline/metrics.json
 *   git commit -m "perf: actualizar baseline — player vX.X.X"
 */

import * as fs   from 'fs'
import * as path from 'path'

const BASELINE_FILE = path.join(process.cwd(), 'performance-baseline', 'metrics.json')
const RESULTS_FILE  = path.join(process.cwd(), 'perf-results', 'current-run.json')

function main(): void {
  if (!fs.existsSync(RESULTS_FILE)) {
    console.error(`\n❌  No se encontró ${RESULTS_FILE}`)
    console.error('   Corre primero: npm run test:performance\n')
    process.exit(1)
  }

  const current = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf-8'))

  // Leer baseline actual para preservar _info y _howto
  const existing = fs.existsSync(BASELINE_FILE)
    ? JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf-8'))
    : {}

  const newBaseline = {
    _info:          existing._info          ?? 'Baseline de performance del Lightning Player. Actualizar con: npm run perf:update-baseline',
    _howto:         existing._howto         ?? '1) Corre npm run test:performance. 2) npm run perf:update-baseline. 3) Commitea este archivo.',
    _updated:       current.timestamp,
    _playerVersion: current.playerVersion,
    _environment:   current.environment,
    _browser:       current.browser,
    metrics:        current.metrics,
  }

  fs.writeFileSync(BASELINE_FILE, JSON.stringify(newBaseline, null, 2))

  const metricsCount = Object.keys(current.metrics).length
  const valuesCount  = Object.values(current.metrics as Record<string, Record<string, number>>)
    .reduce((acc, m) => acc + Object.keys(m).length, 0)

  console.log('\n✅  Baseline actualizado')
  console.log(`   Archivo: ${BASELINE_FILE}`)
  console.log(`   Player:  ${current.playerVersion}`)
  console.log(`   Run:     ${current.timestamp}`)
  console.log(`   Métricas: ${metricsCount} grupos, ${valuesCount} valores\n`)

  console.log('Próximo paso:')
  console.log('   git add performance-baseline/metrics.json')
  console.log('   git commit -m "perf: actualizar baseline — player ' + (current.playerVersion ?? 'vX.X.X') + '"\n')
}

main()
