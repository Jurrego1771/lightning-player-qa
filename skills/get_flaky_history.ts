#!/usr/bin/env ts-node
/**
 * get_flaky_history.ts — Consulta el historial de flakiness de un test
 *
 * Uso:
 *   ts-node skills/get_flaky_history.ts --test "VOD playback > should autoplay"
 *   ts-node skills/get_flaky_history.ts --test "Ads > DAI > cuepoint fires"
 *
 * Lee state/flaky_registry.json.
 * Si el archivo no existe, devuelve valores cero (el test no tiene historial).
 */

import * as path from 'path'
import * as fs from 'fs'

const REPO_ROOT          = path.resolve(__dirname, '..')
const REGISTRY_PATH      = path.join(REPO_ROOT, 'state', 'flaky_registry.json')
const THIRTY_DAYS_MS     = 30 * 24 * 60 * 60 * 1000
const KNOWN_FLAKY_THRESHOLD = 2  // >= 2 ocurrencias en 30 días = known flaky

interface FlakyEntry {
  test_id: string
  occurred_at: string  // ISO8601
  error?: string
  run_id?: string
  spec_file?: string
}

interface ConfirmedBug {
  issue_url?: string
  description: string
  confirmed_at: string
}

interface FlakyRegistryItem {
  test_id: string
  entries: FlakyEntry[]
  confirmed_bugs?: ConfirmedBug[]
}

interface FlakyRegistry {
  tests: FlakyRegistryItem[]
}

interface FlakyHistoryResult {
  test_id: string
  flaky_count_30d: number
  last_flaky: string | null
  confirmed_bugs: ConfirmedBug[]
  is_known_flaky: boolean
}

function die(msg: string): never {
  process.stderr.write(`ERROR: ${msg}\n`)
  process.exit(1)
}

function parseArgs(argv: string[]): { testId: string } {
  const idx = argv.indexOf('--test')
  if (idx === -1 || !argv[idx + 1]) {
    die('--test es requerido. Ej: --test "VOD playback > should autoplay"')
  }
  return { testId: argv[idx + 1] }
}

function loadRegistry(): FlakyRegistry {
  if (!fs.existsSync(REGISTRY_PATH)) {
    return { tests: [] }
  }

  try {
    const raw = fs.readFileSync(REGISTRY_PATH, 'utf8')
    const parsed = JSON.parse(raw) as unknown

    // Aceptar tanto { tests: [...] } como un array plano de items
    if (Array.isArray(parsed)) {
      return { tests: parsed as FlakyRegistryItem[] }
    }
    if (parsed && typeof parsed === 'object' && 'tests' in parsed) {
      return parsed as FlakyRegistry
    }

    process.stderr.write('WARN: flaky_registry.json tiene formato inesperado — ignorando\n')
    return { tests: [] }
  } catch (err) {
    process.stderr.write(`WARN: No se pudo parsear flaky_registry.json: ${(err as Error).message}\n`)
    return { tests: [] }
  }
}

/**
 * Busca un test en el registry usando coincidencia exacta primero,
 * luego parcial (normaliza espacios y mayúsculas).
 */
function findTestEntry(registry: FlakyRegistry, testId: string): FlakyRegistryItem | null {
  // Exacto
  const exact = registry.tests.find(t => t.test_id === testId)
  if (exact) return exact

  // Normalizado (case-insensitive, trim)
  const normalized = testId.toLowerCase().trim()
  const loose = registry.tests.find(t => t.test_id.toLowerCase().trim() === normalized)
  if (loose) return loose

  // Contiene (útil cuando el agente pasa un subconjunto del título)
  const contains = registry.tests.find(
    t => t.test_id.toLowerCase().includes(normalized) ||
         normalized.includes(t.test_id.toLowerCase().trim())
  )
  return contains ?? null
}

async function main() {
  const { testId } = parseArgs(process.argv.slice(2))
  const registry = loadRegistry()

  const item = findTestEntry(registry, testId)

  if (!item) {
    const result: FlakyHistoryResult = {
      test_id:         testId,
      flaky_count_30d: 0,
      last_flaky:      null,
      confirmed_bugs:  [],
      is_known_flaky:  false,
    }
    console.log(JSON.stringify(result, null, 2))
    return
  }

  const now = Date.now()
  const cutoff = now - THIRTY_DAYS_MS

  // Contar entradas en los últimos 30 días
  const recentEntries = (item.entries ?? []).filter(e => {
    try {
      return new Date(e.occurred_at).getTime() >= cutoff
    } catch {
      return false
    }
  })

  const flakyCount30d = recentEntries.length

  // Última ocurrencia (más reciente de todas las entradas, no solo las de 30d)
  let lastFlaky: string | null = null
  if (item.entries && item.entries.length > 0) {
    const sorted = [...item.entries].sort((a, b) => {
      const ta = new Date(a.occurred_at).getTime()
      const tb = new Date(b.occurred_at).getTime()
      return tb - ta  // descendente
    })
    lastFlaky = sorted[0]?.occurred_at ?? null
  }

  const result: FlakyHistoryResult = {
    test_id:         item.test_id,
    flaky_count_30d: flakyCount30d,
    last_flaky:      lastFlaky,
    confirmed_bugs:  item.confirmed_bugs ?? [],
    is_known_flaky:  flakyCount30d >= KNOWN_FLAKY_THRESHOLD,
  }

  console.log(JSON.stringify(result, null, 2))
}

main().catch(e => { console.error(e); process.exit(1) })
