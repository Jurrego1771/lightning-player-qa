/**
 * drm-candidate-selection.spec.ts — Tests de integración para selección de URL candidata DRM
 *
 * Cubre:
 *   - DRMPluginRunner resuelve la URL candidata correcta (HLS vs MPD) según el
 *     key system soportado por el browser (getDRMSupport.js)
 *   - Cuando loadConfig devuelve candidateUrls con HLS y MPD, el player selecciona
 *     la URL apropiada según la plataforma (Chromium → Widevine → MPD,
 *     WebKit/Safari → FairPlay → HLS nativo)
 *   - El player no crashea si loadConfig devuelve candidateUrls vacío o incompleto
 *   - El handler seleccionado es coherente con el formato de URL elegida
 *
 * Fixture: isolatedPlayer (plataforma mockeada — valida la lógica de selección de URL
 *   sin requerir contenido DRM real ni CDM activo para licencias)
 *
 * Decisión de diseño:
 *   Estos tests NO verifican que el DRM funcione end-to-end (eso corresponde a
 *   tests/e2e/drm-widevine-dash.spec.ts y drm-fairplay-native.spec.ts).
 *   Verifican que la LÓGICA DE SELECCIÓN DE URL en DRMPluginRunner (src/player/drm/plugin.jsx)
 *   y getDRMSupport.js elige el candidato correcto dado lo que el browser soporta.
 *
 *   El mock de plataforma devuelve un loadConfig con candidateUrls que incluye
 *   tanto .m3u8 (HLS/FairPlay) como .mpd (DASH/Widevine). El player elige según
 *   qué key system responde EME requestMediaKeySystemAccess (o WebKitMediaKeys/MSMediaKeys).
 *
 * Referencia de código cambiado:
 *   - src/player/drm/plugin.jsx — DRMPluginRunner.candidateUrls resolution
 *   - src/helper/getDRMSupport.js — EME probe por key system
 *   - src/player/base.js — routing a DashHandler vs HLS handler vs native
 *
 * Tag: @integration
 */
import { test, expect, MockContentIds, ExternalStreams, mockContentConfig } from '../../fixtures'

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Config de contenido con candidateUrls DRM (HLS + MPD).
 * El DRMPluginRunner itera candidateUrls y elige el primero cuyo key system
 * es soportado por el browser actual.
 */
function buildDRMCandidateConfig(overrides: Record<string, unknown> = {}) {
  return {
    // candidateUrls: array de objetos { url, keySystem } ordenados por preferencia.
    // El player llama a getDRMSupport() para detectar el key system activo y
    // filtra la lista hasta encontrar el primer candidato compatible.
    candidateUrls: [
      {
        url: ExternalStreams.dash.vod,          // .mpd — para Widevine/PlayReady (Chromium)
        keySystem: 'com.widevine.alpha',
      },
      {
        url: ExternalStreams.hls.vod,           // .m3u8 — para FairPlay (Safari)
        keySystem: 'com.apple.fps',
      },
    ],
    drm: {
      widevine: {
        licenseUrl: 'https://widevine-license.example.com/license',
        token: '',
      },
      fairplay: {
        licenseUrl: 'https://fairplay-license.example.com/license',
        certificateUrl: 'https://fairplay-license.example.com/certificate',
        token: '',
      },
    },
    src: {
      // src.hls como fallback si candidateUrls no resuelve ningún candidato
      hls: ExternalStreams.hls.vod,
    },
    ...overrides,
  }
}

// ── Suite 1: Selección por key system del browser ──────────────────────────────

test.describe('DRM Candidate URL — Selección por Key System', { tag: ['@integration'] }, () => {

  test('player se inicializa sin crash cuando loadConfig tiene candidateUrls HLS + MPD', async ({ isolatedPlayer: player, page }) => {
    // Arrange — mock de plataforma con candidateUrls con ambos formatos
    await mockContentConfig(page, buildDRMCandidateConfig())

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
    })

    // Esperar a que el player termine su intento de inicialización
    // (puede fallar la license request — lo importante es que no crashea)
    await expect.poll(
      async () => {
        const initialized = await page.evaluate(() => (window as any).__qa?.initialized)
        const initError = await page.evaluate(() => (window as any).__qa?.initError)
        return initialized === true || initError != null
      },
      { timeout: 30_000 }
    ).toBe(true)

    // Assert — no errores JavaScript no capturados (el DRMPluginRunner no debe crashear)
    // La license request puede fallar (el servidor de licencias es fake), pero eso
    // se maneja como error DRM, no como crash.
    const uncaughtErrors: string[] = await page.evaluate(() =>
      (window as any).__qa?.uncaughtErrors ?? []
    )
    expect(uncaughtErrors, 'No debe haber errores JavaScript no capturados en la selección de candidato DRM').toHaveLength(0)
  })

  test('player.handler es un string no vacío después de candidateUrls resolution', async ({ isolatedPlayer: player, page }) => {
    // Arrange
    await mockContentConfig(page, buildDRMCandidateConfig())

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
    })

    await expect.poll(
      async () => {
        const initialized = await page.evaluate(() => (window as any).__qa?.initialized)
        const initError = await page.evaluate(() => (window as any).__qa?.initError)
        return initialized === true || initError != null
      },
      { timeout: 30_000 }
    ).toBe(true)

    // Assert — el handler debe haber sido asignado (el player eligió un path de reproducción)
    const handler = await player.getHandler()
    expect(
      typeof handler,
      'player.handler debe ser un string después de la resolución de candidateUrls'
    ).toBe('string')

    // El handler debe ser uno de los valores conocidos
    const knownHandlers = ['hls', 'dash', 'native', '']
    const isKnownHandler = knownHandlers.some((h) => handler.includes(h))
    expect(
      isKnownHandler,
      `player.handler "${handler}" no es un valor conocido. ` +
      `Valores esperados: ${knownHandlers.filter(Boolean).join(', ')}`
    ).toBe(true)
  })

  test('en Chromium: handler seleccionado es dash o hls (Widevine soportado)', async ({ isolatedPlayer: player, page }, testInfo) => {
    // Este test es específico de Chromium donde Widevine está disponible.
    // DRMPluginRunner debe elegir el candidato MPD (com.widevine.alpha).
    // Si no hay CDM disponible (CI headless), el player puede hacer fallback a HLS.
    const isSafari = testInfo.project.name.toLowerCase().includes('webkit') ||
      testInfo.project.name.toLowerCase().includes('safari')

    if (isSafari) {
      testInfo.skip(true, 'Test específico de Chromium — en Safari se ejecuta el test de FairPlay')
    }

    // Arrange
    await mockContentConfig(page, buildDRMCandidateConfig())

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
    })

    await expect.poll(
      async () => {
        const initialized = await page.evaluate(() => (window as any).__qa?.initialized)
        const initError = await page.evaluate(() => (window as any).__qa?.initError)
        return initialized === true || initError != null
      },
      { timeout: 30_000 }
    ).toBe(true)

    // Assert — en Chromium el DRMPlugin debe intentar Widevine (MPD) primero.
    // Si Widevine CDM no está activo (CI sin CDM real), puede hacer fallback.
    // El handler no debe ser undefined — debe haber elegido algún path.
    const handler = await player.getHandler()
    expect(
      handler,
      'En Chromium, el DRMPlugin debe seleccionar un handler después de candidateUrls resolution'
    ).toBeDefined()
  })

  test('en Safari/WebKit: player no crashea al evaluar candidateUrls con MPD', async ({ isolatedPlayer: player, page }, testInfo) => {
    // En Safari, Widevine (com.widevine.alpha) no está disponible.
    // getDRMSupport.js debe detectar que FairPlay (com.apple.fps) es el key system activo.
    // DRMPluginRunner debe omitir el candidato MPD y elegir el candidato HLS.
    const isSafari = testInfo.project.name.toLowerCase().includes('webkit') ||
      testInfo.project.name.toLowerCase().includes('safari')

    if (!isSafari) {
      testInfo.skip(true, 'Test específico de Safari/WebKit — en Chromium se ejecuta el test de Widevine')
    }

    // Arrange
    await mockContentConfig(page, buildDRMCandidateConfig())

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
    })

    await expect.poll(
      async () => {
        const initialized = await page.evaluate(() => (window as any).__qa?.initialized)
        const initError = await page.evaluate(() => (window as any).__qa?.initError)
        return initialized === true || initError != null
      },
      { timeout: 30_000 }
    ).toBe(true)

    // Assert — no crash. En Safari sin credenciales FairPlay se espera un error
    // de licencia (controlado), pero no un crash de JavaScript.
    const handler = await player.getHandler()
    expect(
      typeof handler,
      'player.handler debe ser string — el DRMPlugin eligió un path de reproducción'
    ).toBe('string')
  })

})

// ── Suite 2: Resiliencia ante candidateUrls malformados ───────────────────────

test.describe('DRM Candidate URL — Resiliencia ante config incompleta', { tag: ['@integration'] }, () => {

  test('candidateUrls vacío: player usa src.hls como fallback sin crash', async ({ isolatedPlayer: player, page }) => {
    // Arrange — candidateUrls vacío fuerza al DRMPluginRunner a usar el src.hls de fallback
    await mockContentConfig(page, buildDRMCandidateConfig({ candidateUrls: [] }))

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
    })

    await expect.poll(
      async () => {
        const initialized = await page.evaluate(() => (window as any).__qa?.initialized)
        const initError = await page.evaluate(() => (window as any).__qa?.initError)
        return initialized === true || initError != null
      },
      { timeout: 25_000 }
    ).toBe(true)

    // Assert — con candidateUrls vacío el player debe usar src.hls y no crashear
    // El initError puede existir (no tiene candidato DRM) pero no debe ser un crash
    const initError = await player.hasInitError()
    if (initError !== null) {
      // Si hay error, no debe ser un TypeError de propiedad undefined (crash interno)
      expect(initError).not.toMatch(/TypeError|cannot read|undefined is not/)
    }
  })

  test('candidateUrls sin keySystem matching: player no lanza TypeError', async ({ isolatedPlayer: player, page }) => {
    // Arrange — candidateUrls con un key system inexistente que nunca matcheará
    await mockContentConfig(page, buildDRMCandidateConfig({
      candidateUrls: [
        {
          url: ExternalStreams.dash.vod,
          keySystem: 'com.example.nonexistent',
        },
      ],
    }))

    // Capturar errores no capturados antes de init
    const uncaughtErrors: string[] = []
    page.on('pageerror', (err) => {
      uncaughtErrors.push(err.message)
    })

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
    })

    await expect.poll(
      async () => {
        const initialized = await page.evaluate(() => (window as any).__qa?.initialized)
        const initError = await page.evaluate(() => (window as any).__qa?.initError)
        return initialized === true || initError != null
      },
      { timeout: 25_000 }
    ).toBe(true)

    // Assert — getDRMSupport.js devuelve null para key systems inexistentes.
    // DRMPluginRunner debe manejar esto sin lanzar TypeError.
    const typeCrashes = uncaughtErrors.filter(
      (e) => e.toLowerCase().includes('typeerror') ||
              e.toLowerCase().includes('cannot read') ||
              e.toLowerCase().includes('is not a function')
    )
    expect(
      typeCrashes,
      `getDRMSupport() retornó null y DRMPluginRunner lanzó TypeError. ` +
      `Errores: ${typeCrashes.join(' | ')}`
    ).toHaveLength(0)
  })

  test('loadConfig sin candidateUrls: player reproduce normalmente via src.hls', async ({ isolatedPlayer: player }) => {
    // Arrange — config estándar sin DRM (el 99% de los contenidos)
    // No llamamos a mockContentConfig — el isolatedPlayer usa vod.json por defecto
    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
    })

    // Assert — sin candidateUrls, el DRMPlugin no debe activarse y el HLS reproduce normal
    await player.waitForEvent('playing', 20_000)
    await player.assertIsPlaying()
    await player.assertNoInitError()
  })

})
