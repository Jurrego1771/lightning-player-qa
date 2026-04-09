/**
 * global-setup.ts — Pre-suite health checks
 *
 * Corre UNA VEZ antes de que cualquier worker inicie.
 * Si lanza una excepción → cero tests corren (fail-fast).
 * Las mutaciones a process.env son heredadas por todos los workers.
 *
 * Checks:
 *   FATAL — HLS fixtures: si no existen y no se pueden generar, la suite no corre.
 *   WARN  — External streams: si un stream no está disponible, los tests que lo
 *            usan hacen test.skip() en lugar de fallar con TimeoutError.
 */
import * as fs from 'fs'
import * as https from 'https'
import * as path from 'path'
import type { FullConfig } from '@playwright/test'
import { checkHlsFixtures } from './checks/hls-fixtures'
import { checkExternalStreams } from './checks/stream-health'
import { getEnvironmentConfig } from '../config/environments'

const IMA_SDK_URL  = 'https://imasdk.googleapis.com/js/sdkloader/ima3.js'
const IMA_SDK_PATH = path.resolve(process.cwd(), 'fixtures/ima-sdk/ima3.js')

/**
 * Descarga el IMA SDK de Google y lo guarda localmente para que
 * setupPlatformMocks() lo sirva vía page.route() en tests aislados.
 * Sin esto, IMA SDK tarda 10-20s en cargarse desde CDN en cada test,
 * causando una race condition con el autoplay del contenido.
 */
async function cacheImaSdk(): Promise<{ ok: boolean; cached: boolean; error?: string }> {
  if (fs.existsSync(IMA_SDK_PATH)) {
    return { ok: true, cached: true }
  }

  const dir = path.dirname(IMA_SDK_PATH)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  return new Promise((resolve) => {
    const file = fs.createWriteStream(IMA_SDK_PATH)
    const req = https.get(IMA_SDK_URL, { timeout: 15_000 }, (res) => {
      if (res.statusCode !== 200) {
        file.destroy()
        fs.unlink(IMA_SDK_PATH, () => {})
        resolve({ ok: false, error: `HTTP ${res.statusCode}` })
        return
      }
      res.pipe(file)
      file.on('finish', () => { file.close(); resolve({ ok: true, cached: false }) })
    })
    req.on('error', (err) => {
      file.destroy()
      fs.unlink(IMA_SDK_PATH, () => {})
      resolve({ ok: false, error: err.message })
    })
    req.on('timeout', () => {
      req.destroy()
      resolve({ ok: false, error: 'timeout' })
    })
  })
}

// ANSI helpers
const R  = '\x1b[0m'
const B  = '\x1b[1m'
const G  = '\x1b[32m'
const Y  = '\x1b[33m'
const RD = '\x1b[31m'
const D  = '\x1b[2m'

const LINE = '─'.repeat(56)

const ok   = (s: string) => `${G}✓${R} ${s}`
const fail = (s: string) => `${RD}✗${R} ${s}`
const warn = (s: string) => `${Y}⚠${R} ${s}`
const dim  = (s: string) => `${D}${s}${R}`
const bold = (s: string) => `${B}${s}${R}`

export default async function globalSetup(_config: FullConfig): Promise<void> {
  console.log(`\n${B}${LINE}`)
  console.log(' Pre-suite Health Check')
  console.log(`${LINE}${R}`)

  // ── 1. HLS Fixtures (FATAL) ──────────────────────────────────────────────
  console.log(`\n${bold(' HLS Fixtures')}`)

  try {
    const fixtures = checkHlsFixtures()
    for (const f of fixtures) {
      const note = f.generated ? ` ${dim('(generated)')}` : ''
      console.log(`  ${ok(f.label)}${note}`)
    }
  } catch (err: unknown) {
    console.log(`  ${fail('HLS fixtures unavailable — suite aborted')}\n`)
    throw err
  }

  // ── 2. IMA SDK Cache (WARN) ──────────────────────────────────────────────
  // Cacheamos IMA SDK localmente para que setupPlatformMocks() lo sirva vía
  // page.route() sin depender del CDN de Google en cada test de ads.
  console.log(`\n${bold(' IMA SDK Cache')}`)
  {
    const result = await cacheImaSdk()
    if (result.ok) {
      const note = result.cached ? ` ${dim('(already cached)')}` : ` ${dim('(downloaded)')}`
      console.log(`  ${ok('imasdk.googleapis.com/js/sdkloader/ima3.js')}${note}`)
    } else {
      console.log(`  ${warn(`IMA SDK unavailable — ad tests may fail: ${result.error}`)}`)
    }
  }

  // ── 3. External Streams & Player Script (WARN) ───────────────────────────
  console.log(`\n${bold(' External Streams')}`)

  const envConfig = getEnvironmentConfig()
  const streamResults = await checkExternalStreams(envConfig.playerScriptUrl)

  let warnCount = 0
  for (const r of streamResults) {
    if (r.ok) {
      console.log(`  ${ok(r.label.padEnd(38))} ${dim(`${r.durationMs}ms`)}`)
    } else {
      console.log(`  ${warn(`${r.label.trimEnd()} — ${r.error ?? `HTTP ${r.statusCode}`}`)}`)
      warnCount++
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${LINE}`)
  if (warnCount > 0) {
    console.log(` ${Y}${warnCount} stream(s) unavailable — affected tests will skip${R}`)
  } else {
    console.log(` ${G}All checks passed${R}`)
  }
  console.log('')
}
