/**
 * hls-fixtures.ts — Verifica que los archivos HLS de test existen en disco.
 *
 * Checks fatales: si los fixtures no existen y no se pueden generar,
 * la suite no corre (mejor fallar rápido que fallar con TimeoutError críptico).
 *
 * Si ffmpeg está disponible y los fixtures faltan, los genera automáticamente.
 * En CI el workflow debe ejecutar `npm run fixtures:generate` antes de los tests.
 */
import * as fs from 'fs'
import * as path from 'path'
import { execSync } from 'child_process'

const ROOT = path.resolve(process.cwd())

const REQUIRED_FIXTURES = [
  { label: 'vod/master.m3u8',           path: 'fixtures/streams/vod/master.m3u8' },
  { label: 'audio/index.m3u8',          path: 'fixtures/streams/audio/index.m3u8' },
  { label: 'vod-with-error/index.m3u8', path: 'fixtures/streams/vod-with-error/index.m3u8' },
] as const

export interface FixtureResult {
  label: string
  path: string
  exists: boolean
  generated: boolean
}

function ffmpegAvailable(): boolean {
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

export function checkHlsFixtures(): FixtureResult[] {
  const results: FixtureResult[] = REQUIRED_FIXTURES.map(f => ({
    label: f.label,
    path: f.path,
    exists: fs.existsSync(path.join(ROOT, f.path)),
    generated: false,
  }))

  const missing = results.filter(r => !r.exists)
  if (missing.length === 0) return results

  // ── Fixtures missing — try to auto-generate ────────────────────────────────
  if (!ffmpegAvailable()) {
    throw new Error(
      [
        'HLS fixtures not found and ffmpeg is not available.',
        '',
        'Missing:',
        ...missing.map(r => `  • ${r.path}`),
        '',
        'To fix:',
        '  Local: install ffmpeg, then run:  npm run fixtures:generate',
        '  CI:    add a step before running tests:  npm run fixtures:generate',
      ].join('\n')
    )
  }

  // ffmpeg available — generate now
  execSync('npm run fixtures:generate', { cwd: ROOT, stdio: 'inherit' })

  // Re-verify after generation
  for (const result of results) {
    const nowExists = fs.existsSync(path.join(ROOT, result.path))
    if (!result.exists && nowExists) result.generated = true
    result.exists = nowExists
  }

  const stillMissing = results.filter(r => !r.exists)
  if (stillMissing.length > 0) {
    throw new Error(
      'HLS fixture generation ran but these files are still missing:\n' +
      stillMissing.map(r => `  • ${r.path}`).join('\n')
    )
  }

  return results
}
