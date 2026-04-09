/**
 * perf-storage.ts — Almacenamiento de métricas de performance por run
 *
 * Acumula las métricas medidas durante los tests de performance y las
 * escribe en `perf-results/current-run.json` después de cada `record()`.
 *
 * Flujo:
 *   1. Tests importan PerfStorage y llaman a record() después de medir
 *   2. Al terminar el run: npm run perf:compare  → detecta regresiones
 *   3. Si el run es bueno: npm run perf:update-baseline → actualiza el baseline
 *
 * El archivo de resultados es gitignored (salida del run actual).
 * El baseline en performance-baseline/metrics.json sí se commitea.
 */

import * as fs from 'fs'
import * as path from 'path'

const RESULTS_DIR  = path.join(process.cwd(), 'perf-results')
const RESULTS_FILE = path.join(RESULTS_DIR, 'current-run.json')

export interface PerfRunData {
  timestamp:     string
  playerVersion: string
  environment:   string
  browser:       string
  metrics:       Record<string, Record<string, number>>
}

// Acumulador en memoria para el run completo.
// Se escribe a disco en cada record() para no perder datos si el run falla a mitad.
const _store: PerfRunData = {
  timestamp:     new Date().toISOString(),
  playerVersion: process.env.PLAYER_VERSION ?? 'unknown',
  environment:   process.env.PLAYER_ENV    ?? 'dev',
  browser:       'chromium',  // los tests de perf siempre corren en chromium (CDP)
  metrics:       {},
}

function _persist(): void {
  fs.mkdirSync(RESULTS_DIR, { recursive: true })
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(_store, null, 2))
}

export const PerfStorage = {
  /**
   * Registra un conjunto de métricas bajo una clave descriptiva.
   * Se puede llamar varias veces con la misma clave para agregar valores.
   *
   * @param key   Identificador del test (ej: 'startup_hls', 'seek_latency')
   * @param values Objeto con los valores medidos (números)
   *
   * @example
   * PerfStorage.record('startup_hls', {
   *   timeToFirstFrame_ms: 850,
   *   timeToLoadedMetadata_ms: 420,
   * })
   */
  record(key: string, values: Record<string, number>): void {
    _store.metrics[key] = { ..._store.metrics[key], ...values }
    _persist()
  },

  resultsPath(): string {
    return RESULTS_FILE
  },
}
