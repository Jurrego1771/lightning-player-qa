/**
 * platform-mock.ts — Interceptación de la plataforma Mediastream para tests aislados
 *
 * El Lightning Player hace dos requests al inicializarse:
 *   1. Player config → GET develop.mdstrm.com/{type}/{id}/player/{playerId}?...
 *      Determina el view type (video/audio/radio) y la UI del player.
 *   2. Content config → GET develop.mdstrm.com/{renderAs}/{id}.json?...
 *      Donde renderAs es 'video' o 'audio' según el view type del player config.
 *      Para type='media' sin renderAs, la URL es /audio/{id}.json por defecto.
 *
 * Usamos un ÚNICO route catch-all en develop.mdstrm.com para evitar problemas
 * de glob pattern matching (URLs con query strings, trailing slashes, etc.)
 */

import { Page } from '@playwright/test'
import * as path from 'path'
import * as fs from 'fs'

const RESPONSES_DIR = path.join(__dirname, 'platform-responses')

function readFixture(relativePath: string): string {
  return fs.readFileSync(path.join(RESPONSES_DIR, relativePath), 'utf-8')
}

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

// Un único route catch-all para toda la plataforma Mediastream.
// Despacha según el path de la URL para evitar problemas con globs y query strings.
// Llamar antes de player.goto() — el fixture isolatedPlayer lo hace automáticamente.
export async function setupPlatformMocks(page: Page): Promise<void> {
  await page.route('**/develop.mdstrm.com/**', async (route) => {
    const url = route.request().url()
    const parsedPath = new URL(url).pathname

    // Player config: /{type}/{id}/player/{playerId}
    if (parsedPath.includes('/player')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: FIXTURES.player.default,
      })
      return
    }

    // Live / DVR content config: /live-stream/{id}.json
    if (parsedPath.includes('/live-stream/')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: FIXTURES.content.live,
      })
      return
    }

    // Audio-only content config: /audio/{id}.json (también usado por type=media sin renderAs)
    // Retornamos vod.json con player.type=video para que el player inicie correctamente.
    // Para tests que genuinamente necesiten audio, pasar view:'audio' en goto().
    if (parsedPath.includes('/audio/') && parsedPath.endsWith('.json')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: FIXTURES.content.vod,
      })
      return
    }

    // Video content config: /video/{id}.json
    if (parsedPath.includes('/video/') && parsedPath.endsWith('.json')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: FIXTURES.content.vod,
      })
      return
    }

    // Episode content config: /episode/{id}.json
    if (parsedPath.includes('/episode/') && parsedPath.endsWith('.json')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: FIXTURES.content.vod,
      })
      return
    }

    // Cualquier otra request a develop.mdstrm.com: continuar (no bloquear)
    await route.continue()
  })
}

// ── Overrides específicos ──────────────────────────────────────────────────

export async function mockContentConfig(
  page: Page,
  overrides: Record<string, unknown>
): Promise<void> {
  const base = JSON.parse(FIXTURES.content.vod)
  const merged = { ...base, ...overrides }

  await page.route('**/develop.mdstrm.com/**', async (route) => {
    const parsedPath = new URL(route.request().url()).pathname
    if (parsedPath.includes('/player')) {
      await route.continue()
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(merged),
    })
  })
}

export async function mockPlayerConfig(
  page: Page,
  overrides: Record<string, unknown>
): Promise<void> {
  const base = JSON.parse(FIXTURES.player.default)
  const merged = { ...base, ...overrides }

  await page.route('**/develop.mdstrm.com/**', async (route) => {
    const parsedPath = new URL(route.request().url()).pathname
    if (!parsedPath.includes('/player')) {
      await route.continue()
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(merged),
    })
  })
}

export async function mockContentError(
  page: Page,
  status: number = 403
): Promise<void> {
  await page.route('**/develop.mdstrm.com/**', async (route) => {
    const parsedPath = new URL(route.request().url()).pathname
    if (parsedPath.includes('/player')) {
      await route.continue()
      return
    }
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: FIXTURES.content.error403,
    })
  })
}
