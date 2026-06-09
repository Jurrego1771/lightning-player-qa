/**
 * platform-schema.ts — Valida que los fixtures de plataforma conforme al schema esperado.
 *
 * Los fixtures en fixtures/platform-responses/ son los JSON que setupPlatformMocks()
 * devuelve al player en lugar de la plataforma real. Si su estructura se desvía del
 * contrato esperado, los tests fallan con errores crípticos (timeout, undefined, etc.)
 * en lugar de un error claro de schema.
 *
 * WARN (no FATAL): una fixture malformada afecta a los tests que la usan, pero no
 * debe bloquear la suite entera. El reporte identifica exactamente qué rompió.
 */
import * as fs from 'fs'
import * as path from 'path'

const FIXTURES_DIR = path.resolve(process.cwd(), 'fixtures', 'platform-responses')

// ── Schema types ──────────────────────────────────────────────────────────────

interface SchemaError {
  fixture: string
  field: string
  expected: string
  received: string
}

// ── Content config schema ─────────────────────────────────────────────────────

const CONTENT_FIXTURES = [
  'content/vod.json',
  'content/live.json',
  'content/audio.json',
  'content/episode.json',
  'content/dash.json',
]

function validateContentConfig(data: unknown, label: string): SchemaError[] {
  const errors: SchemaError[] = []
  const d = data as Record<string, unknown>

  if (typeof d !== 'object' || d === null) {
    return [{ fixture: label, field: '(root)', expected: 'object', received: typeof d }]
  }

  // Required string fields
  for (const field of ['title', 'account', 'mediaId'] as const) {
    if (typeof d[field] !== 'string') {
      errors.push({ fixture: label, field, expected: 'string', received: typeof d[field] })
    }
  }

  // src — must be object with at least one of hls | mp4 | dash
  if (typeof d.src !== 'object' || d.src === null) {
    errors.push({ fixture: label, field: 'src', expected: 'object', received: typeof d.src })
  } else {
    const src = d.src as Record<string, unknown>
    const hasStream = typeof src.hls === 'string' || typeof src.mp4 === 'string' || typeof src.dash === 'string' || typeof src.mpd === 'string'
    if (!hasStream) {
      errors.push({ fixture: label, field: 'src.{hls|mp4|dash|mpd}', expected: 'at least one string stream URL', received: JSON.stringify(src) })
    }
  }

  // subtitles — must be array (can be empty)
  if (!Array.isArray(d.subtitles)) {
    errors.push({ fixture: label, field: 'subtitles', expected: 'array', received: typeof d.subtitles })
  }

  // ads — must be object (can be empty {})
  if (typeof d.ads !== 'object') {
    errors.push({ fixture: label, field: 'ads', expected: 'object', received: typeof d.ads })
  }

  // drm — null or object
  if (d.drm !== null && typeof d.drm !== 'object') {
    errors.push({ fixture: label, field: 'drm', expected: 'null | object', received: typeof d.drm })
  }

  return errors
}

// ── Player config schema ──────────────────────────────────────────────────────

const PLAYER_FIXTURES = [
  'player/default.json',
  'player/audio.json',
  'player/compact.json',
  'player/radio.json',
]

function validatePlayerConfig(data: unknown, label: string): SchemaError[] {
  const errors: SchemaError[] = []
  const d = data as Record<string, unknown>

  if (typeof d !== 'object' || d === null) {
    return [{ fixture: label, field: '(root)', expected: 'object', received: typeof d }]
  }

  if (typeof d.name !== 'string') {
    errors.push({ fixture: label, field: 'name', expected: 'string', received: typeof d.name })
  }

  if (typeof d.autoplay !== 'boolean') {
    errors.push({ fixture: label, field: 'autoplay', expected: 'boolean', received: typeof d.autoplay })
  }

  if (typeof d.debug !== 'boolean') {
    errors.push({ fixture: label, field: 'debug', expected: 'boolean', received: typeof d.debug })
  }

  if (typeof d.volume !== 'number' || (d.volume as number) < 0 || (d.volume as number) > 1) {
    errors.push({ fixture: label, field: 'volume', expected: 'number (0–1)', received: String(d.volume) })
  }

  if (typeof d.view !== 'object' || d.view === null) {
    errors.push({ fixture: label, field: 'view', expected: 'object', received: typeof d.view })
  } else {
    const view = d.view as Record<string, unknown>
    if (typeof view.type !== 'string') {
      errors.push({ fixture: label, field: 'view.type', expected: 'string', received: typeof view.type })
    }
  }

  return errors
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface SchemaCheckResult {
  fixture: string
  ok: boolean
  errors: SchemaError[]
}

export function checkPlatformSchemas(): SchemaCheckResult[] {
  const results: SchemaCheckResult[] = []

  for (const rel of CONTENT_FIXTURES) {
    const fullPath = path.join(FIXTURES_DIR, rel)
    if (!fs.existsSync(fullPath)) {
      results.push({ fixture: rel, ok: false, errors: [{ fixture: rel, field: '(file)', expected: 'exists', received: 'missing' }] })
      continue
    }
    let data: unknown
    try {
      data = JSON.parse(fs.readFileSync(fullPath, 'utf-8'))
    } catch (e) {
      results.push({ fixture: rel, ok: false, errors: [{ fixture: rel, field: '(parse)', expected: 'valid JSON', received: String(e) }] })
      continue
    }
    const errors = validateContentConfig(data, rel)
    results.push({ fixture: rel, ok: errors.length === 0, errors })
  }

  for (const rel of PLAYER_FIXTURES) {
    const fullPath = path.join(FIXTURES_DIR, rel)
    if (!fs.existsSync(fullPath)) {
      results.push({ fixture: rel, ok: false, errors: [{ fixture: rel, field: '(file)', expected: 'exists', received: 'missing' }] })
      continue
    }
    let data: unknown
    try {
      data = JSON.parse(fs.readFileSync(fullPath, 'utf-8'))
    } catch (e) {
      results.push({ fixture: rel, ok: false, errors: [{ fixture: rel, field: '(parse)', expected: 'valid JSON', received: String(e) }] })
      continue
    }
    const errors = validatePlayerConfig(data, rel)
    results.push({ fixture: rel, ok: errors.length === 0, errors })
  }

  return results
}
