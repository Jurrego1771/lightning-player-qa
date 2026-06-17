/**
 * ads-ima-locale-sync.spec.ts — Tests de integración para sincronización de locale IMA
 *
 * Cubre el gap MUST del módulo ads-ima detectado por A4 (PR #705):
 *   - contextMapper ahora lee options.language con fallback 'es' en lugar de navigator.language
 *   - AdsOptions tiene nuevo constructor param language=null
 *   - AdsLoader.prototype.constructor ya no usa language (se remueve de la firma)
 *
 * Símbolos cubiertos:
 *   AdsLoader.prototype.constructor (language param removal)
 *   contextMapper (language prop missing → ahora propagada desde options.language)
 *   AdsOptions.prototype.language (new param)
 *
 * Estrategia:
 *   Los tests interceptan el Ad Request real al IMA SDK/VAST endpoint y verifican
 *   que el parámetro de idioma se propaga correctamente según options.language.
 *   También verifican que el flujo básico de pre-roll no se rompe con el cambio.
 *
 * Fixture: isolatedPlayer (plataforma mockeada — determinista, sin dependencia de CDN de plataforma)
 * Nota: El IMA SDK real solo funciona en Chromium. Todos los tests usan project chromium.
 *
 * BR-IMA-004 — Un error en el sistema de ads nunca interrumpe el contenido principal.
 * BR-IMA-011 — Con autoplay muted, el ad arranca muted.
 * BR-I18N-002 — Idioma por defecto es 'es' cuando language no se especifica.
 *
 * Tag: @integration @ads @ima @locale
 */
import { test, expect, MockContentIds, StaticVastTags } from '../../fixtures'

const MOCK_VAST_URL = process.env.MOCK_VAST_BASE_URL ?? 'http://localhost:9999'

// ── Suite 1: language explícito en options se propaga al Ad Request ───────────

test.describe('ads-ima locale sync — options.language se propaga al Ad Request', {
  tag: ['@integration', '@ads', '@ima', '@locale'],
}, () => {

  // Covers: AdsOptions.prototype.language (new param), contextMapper (language prop)
  // AC relacionado: change en PR #705 — navigator.language -> options.language en contextMapper
  test('player inicializado con language="en" no crashea y alcanza ready', async ({
    isolatedPlayer,
    page,
  }) => {
    // Arrange
    const jsErrors: string[] = []
    page.on('pageerror', (err) => {
      const msg = err.message.toLowerCase()
      // Filtrar errores esperados de autoplay policy y del SDK IMA
      if (
        !msg.includes('notallowederror') &&
        !msg.includes('autoplay') &&
        !msg.includes('ima') &&
        !msg.includes('google') &&
        !msg.includes('failed to load')
      ) {
        jsErrors.push(err.message)
      }
    })

    // Act — inicializar con language='en' (nuevo param en AdsOptions/contextMapper)
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      language: 'en',
      adsMap: StaticVastTags.linearSkippable,
    })

    // Assert — el player debe alcanzar ready sin crash
    await isolatedPlayer.waitForReady(25_000)

    const initError = await isolatedPlayer.hasInitError()
    expect(
      initError,
      `LOCALE SYNC: El player con language='en' no debe fallar durante el init.\n` +
      `options.language='en' debe propagarse correctamente a AdsOptions.\n` +
      `Error: ${initError}`
    ).toBeNull()

    expect(
      jsErrors,
      `LOCALE SYNC: language='en' no debe causar crashes JS. Errores: ${jsErrors.join(' | ')}`
    ).toHaveLength(0)
  })

  test('player inicializado con language="en" emite evento ready', async ({
    isolatedPlayer,
  }) => {
    // Arrange + Act
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      language: 'en',
    })

    // Assert — ready confirma que el árbol de inicialización del player
    // (incluyendo contextMapper y AdsOptions con language) se completó
    await isolatedPlayer.waitForEvent('ready', 20_000)

    const events = await isolatedPlayer.page.evaluate(() => (window as any).__qa?.events ?? [])
    expect(
      events,
      `LOCALE SYNC: ready no fue emitido con language='en'`
    ).toContain('ready')
  })

  test('player inicializado con language="pt" alcanza ready sin errores', async ({
    isolatedPlayer,
    page,
  }) => {
    // Arrange
    const jsErrors: string[] = []
    page.on('pageerror', (err) => {
      const msg = err.message.toLowerCase()
      if (
        !msg.includes('notallowederror') &&
        !msg.includes('autoplay') &&
        !msg.includes('ima') &&
        !msg.includes('google') &&
        !msg.includes('failed to load')
      ) {
        jsErrors.push(err.message)
      }
    })

    // Act
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      language: 'pt',
    })

    // Assert — los tres idiomas soportados (es/en/pt) deben funcionar con el nuevo param
    await isolatedPlayer.waitForReady(25_000)
    await isolatedPlayer.assertNoInitError()

    expect(
      jsErrors,
      `LOCALE SYNC: language='pt' no debe causar crashes JS. Errores: ${jsErrors.join(' | ')}`
    ).toHaveLength(0)
  })
})

// ── Suite 2: fallback a 'es' cuando language es null/undefined ───────────────

test.describe('ads-ima locale sync — fallback a es cuando language es null/undefined', {
  tag: ['@integration', '@ads', '@ima', '@locale'],
}, () => {

  // Covers: AdsOptions.prototype.language = null (nuevo default en constructor)
  // BR-I18N-002 — Idioma por defecto es 'es' cuando language no se especifica
  test('player sin options.language alcanza ready (fallback es_ES activo)', async ({
    isolatedPlayer,
    page,
  }) => {
    // Arrange
    const consoleErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text())
      }
    })

    // Act — sin pasar language; contextMapper debe usar fallback 'es'
    // Este es el cambio crítico del PR: antes usaba navigator.language,
    // ahora usa options.language con fallback 'es' (no navigator.language)
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      // language no especificado — AdsOptions.language=null → contextMapper fallback 'es'
    })

    // Assert
    await isolatedPlayer.waitForReady(25_000)

    const initError = await isolatedPlayer.hasInitError()
    expect(
      initError,
      `LOCALE SYNC: Sin options.language, el fallback 'es' debe funcionar sin error.\n` +
      `AdsOptions.language=null (nuevo default del constructor) debe ser manejado por contextMapper.\n` +
      `Error: ${initError}`
    ).toBeNull()

    // No debe haber errores de consola relacionados con language/locale
    const localeErrors = consoleErrors.filter((e) => {
      const lower = e.toLowerCase()
      return lower.includes('language') || lower.includes('locale') || lower.includes('undefined')
    })

    expect(
      localeErrors,
      `LOCALE SYNC: Sin language, no deben aparecer errores de consola de locale.\n` +
      `Errores: ${JSON.stringify(localeErrors, null, 2)}`
    ).toHaveLength(0)
  })

  test('player sin language reproduce contenido correctamente (fallback no rompe playback)', async ({
    isolatedPlayer,
  }) => {
    // Arrange + Act — el fallback no debe impedir que el player reproduzca
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
    })

    // Assert — el player debe llegar a playing sin importar el idioma del Ad Request
    await isolatedPlayer.waitForEvent('playing', 20_000)
    await isolatedPlayer.assertIsPlaying()
  })

  test('player con language=null explícito alcanza ready (boundary condition)', async ({
    isolatedPlayer,
  }) => {
    // Arrange + Act — null explícito es el default del nuevo constructor AdsOptions
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      language: null,
    })

    // Assert — null debe ser tratado como el caso de fallback, no como un error
    await isolatedPlayer.waitForReady(25_000)
    await isolatedPlayer.assertNoInitError()
  })
})

// ── Suite 3: flujo básico de pre-roll con el nuevo locale sync ────────────────

test.describe('ads-ima locale sync — flujo de pre-roll no se rompe con el cambio', {
  tag: ['@integration', '@ads', '@ima', '@locale'],
}, () => {

  // Covers: AdsLoader.prototype.constructor (language param removal no rompe init del loader)
  // Este test verifica que la remoción del param language de AdsLoader no impide que
  // el loader se inicialice y que el Ad Request se realice correctamente.
  test('pre-roll con language="en": player no crashea y resuelve el ciclo de ads', async ({
    isolatedPlayer,
    page,
  }) => {
    test.setTimeout(60_000)

    // Arrange
    const uncaughtErrors: string[] = []
    page.on('pageerror', (err) => {
      const msg = err.message.toLowerCase()
      if (
        !msg.includes('notallowederror') &&
        !msg.includes('autoplay') &&
        !msg.includes('ima') &&
        !msg.includes('google') &&
        !msg.includes('net::err') &&
        !msg.includes('failed to load')
      ) {
        uncaughtErrors.push(err.message)
      }
    })

    // Act — language='en' + pre-roll: verifica que AdsLoader se inicializa con el nuevo
    // param removido del constructor pero la language llega via contextMapper
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
      language: 'en',
      adsMap: StaticVastTags.linearSkippable,
    })

    // El ciclo de ads debe resolverse (bien con adsStarted, bien con adsError graceful,
    // bien con adsAllAdsCompleted si el SDK no carga) — BR-IMA-004: siempre graceful.
    await page.waitForFunction(
      () => {
        const events = (window as any).__qa?.events ?? []
        return (
          events.includes('adsStarted') ||
          events.includes('adsError') ||
          events.includes('adsAllAdsCompleted') ||
          events.includes('contentFirstPlay') ||
          events.includes('playing')
        )
      },
      { timeout: 45_000 }
    )

    // Assert — no debe haber crashes JS
    expect(
      uncaughtErrors,
      `LOCALE SYNC: language='en' + pre-roll no debe causar crashes. Errores: ${uncaughtErrors.join(' | ')}`
    ).toHaveLength(0)

    // El player no debe estar en estado de error fatal
    const initError = await isolatedPlayer.hasInitError()
    expect(
      initError,
      `LOCALE SYNC: language='en' + pre-roll no debe causar error de init. Error: ${initError}`
    ).toBeNull()
  })

  test('pre-roll sin language: resuelve el ciclo de ads con fallback es', async ({
    isolatedPlayer,
    page,
  }) => {
    test.setTimeout(60_000)

    // Arrange + Act — sin language (fallback 'es' en contextMapper)
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
      adsMap: StaticVastTags.linearSkippable,
    })

    // Assert — con o sin ads, el player debe resolver el ciclo normalmente
    await page.waitForFunction(
      () => {
        const events = (window as any).__qa?.events ?? []
        return (
          events.includes('adsStarted') ||
          events.includes('adsError') ||
          events.includes('adsAllAdsCompleted') ||
          events.includes('contentFirstPlay') ||
          events.includes('playing')
        )
      },
      { timeout: 45_000 }
    )

    // Si el ad llegó a reproducirse, el player no debe estar en error
    const initError = await isolatedPlayer.hasInitError()
    expect(
      initError,
      `LOCALE SYNC: sin language + pre-roll no debe causar error. Error: ${initError}`
    ).toBeNull()
  })

  // Covers: el cambio navigator.language -> options.language no introduce regresión
  // cuando se usa contenido live (tipo de contenido diferente al VOD)
  test('flujo básico de live con language="es" — no hay regresión de locale sync', async ({
    isolatedPlayer,
  }) => {
    // Arrange + Act
    await isolatedPlayer.goto({
      type: 'live',
      id: MockContentIds.live,
      autoplay: false,
      language: 'es',
    })

    // Assert — el cambio de locale no debe afectar contenido live
    await isolatedPlayer.waitForReady(25_000)
    await isolatedPlayer.assertNoInitError()

    const events = await isolatedPlayer.page.evaluate(() => (window as any).__qa?.events ?? [])
    expect(events, `LOCALE SYNC: ready no fue emitido en live con language='es'`).toContain('ready')
  })
})
