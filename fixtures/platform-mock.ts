/**
 * platform-mock.ts — Interceptación de la plataforma Mediastream para tests aislados
 *
 * El Lightning Player hace dos requests al inicializarse:
 *   1. Content config → GET develop.mdstrm.com/{content-type}/{id}.json?...
 *   2. Player config  → GET develop.mdstrm.com/{content-type}/{id}/player/{playerId}?...
 *
 * Este módulo intercepta ambas con page.route() y devuelve JSON controlado
 * que apunta a streams HLS locales (localhost:9001).
 *
 * Uso:
 *   import { setupPlatformMocks } from '../fixtures/platform-mock'
 *   await setupPlatformMocks(page)           // mock genérico para todos los tipos
 *   await mockContentError(page, 403)        // simular contenido restringido
 */

import { Page } from '@playwright/test'
import * as path from 'path'
import * as fs from 'fs'

const RESPONSES_DIR = path.join(__dirname, 'platform-responses')

function readFixture(relativePath: string): string {
  return fs.readFileSync(path.join(RESPONSES_DIR, relativePath), 'utf-8')
}

// ── Fixtures pre-cargados en memoria (evitar I/O por cada request) ─────────

const FIXTURES = {
  content: {
    vod: readFixture('content/vod.json'),
    live: readFixture('content/live.json'),
    audio: readFixture('content/audio.json'),
    error403: readFixture('content/error-403.json'),
  },
  player: {
    default: readFixture('player/default.json'),
    radio: readFixture('player/radio.json'),
    compact: readFixture('player/compact.json'),
  },
} as const

// ── Setup principal ────────────────────────────────────────────────────────

// Intercepta content config (develop.mdstrm.com/{type}/{id}.json) y player config
// (develop.mdstrm.com/{type}/{id}/player/{playerId}) con respuestas locales.
// Llamar antes de player.goto() — el fixture isolatedPlayer lo hace automáticamente.
export async function setupPlatformMocks(page: Page): Promise<void> {
  // Player config — responde a cualquier /player/ endpoint
  await page.route('**/develop.mdstrm.com/**/player/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: FIXTURES.player.default,
    })
  })

  // Content config — video VOD
  await page.route('**/develop.mdstrm.com/video/**.json**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: FIXTURES.content.vod,
    })
  })

  // Content config — episode (alias de video)
  await page.route('**/develop.mdstrm.com/episode/**.json**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: FIXTURES.content.vod,
    })
  })

  // Content config — audio
  await page.route('**/develop.mdstrm.com/audio/**.json**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: FIXTURES.content.audio,
    })
  })

  // Content config — live / DVR
  await page.route('**/develop.mdstrm.com/live-stream/**.json**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: FIXTURES.content.live,
    })
  })
}

// ── Overrides específicos ──────────────────────────────────────────────────

/**
 * Override del content config para un tipo específico.
 * Útil para tests que necesitan controlar campos concretos (e.g. subtitles, drm).
 *
 * @example
 * await mockContentConfig(page, {
 *   src: { hls: 'http://localhost:9001/vod/master.m3u8' },
 *   subtitles: [{ src: 'http://localhost:9001/subs/es.vtt', lang: 'es', label: 'Español' }],
 * })
 */
export async function mockContentConfig(
  page: Page,
  overrides: Record<string, unknown>,
  contentTypePattern = '**/develop.mdstrm.com/**/*.json**'
): Promise<void> {
  const base = JSON.parse(FIXTURES.content.vod)
  const merged = { ...base, ...overrides }

  await page.route(contentTypePattern, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(merged),
    })
  })
}

/**
 * Override del player config.
 *
 * @example
 * await mockPlayerConfig(page, { view: { type: 'compact' } })
 */
export async function mockPlayerConfig(
  page: Page,
  overrides: Record<string, unknown>
): Promise<void> {
  const base = JSON.parse(FIXTURES.player.default)
  const merged = { ...base, ...overrides }

  await page.route('**/develop.mdstrm.com/**/player/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(merged),
    })
  })
}

/**
 * Simula un error de la plataforma (acceso restringido, contenido no encontrado, etc.).
 * El player debe manejar el error y emitir el evento `error`.
 *
 * @example
 * await mockContentError(page, 403) // ACCESS_DENIED
 * await mockContentError(page, 404) // NOT_FOUND
 */
export async function mockContentError(
  page: Page,
  status: number = 403
): Promise<void> {
  await page.route('**/develop.mdstrm.com/**/*.json**', async (route) => {
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: FIXTURES.content.error403,
    })
  })
}
