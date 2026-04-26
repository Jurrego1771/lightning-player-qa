/**
 * platform-mock.ts — Interceptación de la plataforma Mediastream para tests aislados
 *
 * El Lightning Player hace dos requests al inicializarse:
 *   1. Player config → GET {platformDomain}/{type}/{id}/player/{playerId}?...
 *      Determina el view type (video/audio/radio) y la UI del player.
 *   2. Content config → GET {platformDomain}/{renderAs}/{id}.json?...
 *      Donde renderAs es 'video' o 'audio' según el view type del player config.
 *      Para type='media' sin renderAs, la URL es /audio/{id}.json por defecto.
 *
 * El dominio ({platformDomain}) varía según el ambiente (PLAYER_ENV):
 *   dev     → develop.mdstrm.com
 *   staging → staging.mdstrm.com  (TODO: verificar con player team)
 *   prod    → embed.mdstrm.com
 *
 * Usamos un ÚNICO route catch-all para evitar problemas con globs y query strings.
 */

import { Page } from '@playwright/test'
import * as path from 'path'
import * as fs from 'fs'
import { getEnvironmentConfig } from '../config/environments'

const RESPONSES_DIR = path.join(__dirname, 'platform-responses')

// IMA SDK cacheado localmente por globalSetup para evitar la race condition
// entre el autoplay del contenido y la carga de IMA SDK desde CDN de Google.
const IMA_SDK_CACHED = path.resolve(process.cwd(), 'fixtures/ima-sdk/ima3.js')

function readFixture(relativePath: string): string {
  return fs.readFileSync(path.join(RESPONSES_DIR, relativePath), 'utf-8')
}

const FIXTURES = {
  content: {
    vod: readFixture('content/vod.json'),
    live: readFixture('content/live.json'),
    audio: readFixture('content/audio.json'),
    dash: readFixture('content/dash.json'),
    error403: readFixture('content/error-403.json'),
  },
  player: {
    default: readFixture('player/default.json'),
    audio: readFixture('player/audio.json'),
    radio: readFixture('player/radio.json'),
    compact: readFixture('player/compact.json'),
  },
} as const

// ── Setup principal ────────────────────────────────────────────────────────

// Un único route catch-all para toda la plataforma Mediastream.
// Despacha según el path de la URL para evitar problemas con globs y query strings.
// Llamar antes de player.goto() — el fixture isolatedPlayer lo hace automáticamente.
// El dominio interceptado se toma del ambiente activo (PLAYER_ENV) para que el mock
// funcione correctamente sin importar si se corre en dev, staging o prod.
export async function setupPlatformMocks(page: Page): Promise<void> {
  const { platformDomain } = getEnvironmentConfig()

  // El audio view player solicita datos de waveform a platform-devel.s-mdstrm.com
  // para renderizar la visualización de ondas de audio. Con mock content IDs
  // este endpoint puede colgar (el servidor no responde para IDs inexistentes).
  // Interceptamos con un array vacío — el player lo maneja gracefully.
  await page.route('**/platform-devel.s-mdstrm.com/waveform/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    })
  })

  await page.route(`**/${platformDomain}/**`, async (route) => {
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

    // Audio-only content config: /audio/{id}.json
    if (parsedPath.includes('/audio/') && parsedPath.endsWith('.json')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: FIXTURES.content.audio,
      })
      return
    }

    // Video content config: /video/{id}.json
    if (parsedPath.includes('/video/') && parsedPath.endsWith('.json')) {
      const body = parsedPath.includes('mock-dash')
        ? FIXTURES.content.dash
        : FIXTURES.content.vod
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body,
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

    // Cualquier otra request al dominio de la plataforma: continuar (no bloquear)
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
  const { platformDomain } = getEnvironmentConfig()

  await page.route(`**/${platformDomain}/**`, async (route) => {
    const parsedPath = new URL(route.request().url()).pathname
    if (parsedPath.includes('/player')) {
      await route.fallback()
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
  const merged = {
    ...base,
    ...overrides,
    // Deep-merge view so overrides.view.type doesn't drop base.view.style
    view: { ...base.view, ...((overrides.view as Record<string, unknown>) || {}) },
  }
  const { platformDomain } = getEnvironmentConfig()

  await page.route(`**/${platformDomain}/**`, async (route) => {
    const parsedPath = new URL(route.request().url()).pathname
    if (!parsedPath.includes('/player')) {
      await route.fallback()
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(merged),
    })
  })
}

/**
 * Sobrescribe el player config para usar view: audio.
 * Llamar DENTRO del test body (después de que isolatedPlayer se inicialice) para
 * que esta ruta tenga precedencia LIFO sobre la de setupPlatformMocks.
 * Usa route.fallback() para que las requests de contenido sigan yendo a setupPlatformMocks.
 */
export async function mockAudioPlayerConfig(page: Page): Promise<void> {
  const { platformDomain } = getEnvironmentConfig()
  await page.route(`**/${platformDomain}/**`, async (route) => {
    const parsedPath = new URL(route.request().url()).pathname
    if (parsedPath.includes('/player')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: FIXTURES.player.audio,
      })
      return
    }
    await route.fallback()
  })
}

export async function mockContentError(
  page: Page,
  status: number = 403
): Promise<void> {
  const { platformDomain } = getEnvironmentConfig()
  await page.route(`**/${platformDomain}/**`, async (route) => {
    const parsedPath = new URL(route.request().url()).pathname
    if (parsedPath.includes('/player')) {
      await route.fallback()
      return
    }
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: FIXTURES.content.error403,
    })
  })
}
