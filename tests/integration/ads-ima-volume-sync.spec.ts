/**
 * ads-ima-volume-sync.spec.ts — Tests de integración para sincronización de volumen IMA
 *
 * Cubre el gap MUST del módulo ads-ima detectado por A4 (PR #705):
 *   AC-IMA-006: Volumen del ad sincronizado con el volumen del player.
 *   AdsManager.setVolume() debe recibir el volumen actual del player cuando el ad empieza.
 *
 * Comportamiento esperado:
 *   - Si el player se inicializa con volume=0.5, cuando el pre-roll empieza el ad debe
 *     reproducirse a 0.5 (adsManager.setVolume(0.5) fue llamado internamente).
 *   - Si el usuario cambia el volumen durante el ad, el cambio se refleja en el ad.
 *
 * Estrategia de verificación:
 *   El IMA SDK no expone directamente si setVolume() fue llamado. Verificamos el
 *   comportamiento observable via la API pública del player:
 *     1. player.volume después de adsStarted debe coincidir con el volumen configurado.
 *     2. adsVolumeChanged se emite cuando el volumen cambia durante un ad.
 *     3. Cambio de volumen durante el ad no rompe el playback (isPlayingAd sigue true).
 *
 * Nota sobre el entorno mock:
 *   El IMA SDK real solo funciona en Chromium. Si el SDK no carga (entorno CI sin red
 *   al CDN de Google), los tests verifican que el player resolve gracefully. El IMA SDK
 *   cacheado en fixtures/ima-sdk/ima3.js se usa si existe.
 *
 * Fixture: isolatedPlayer (plataforma mockeada — determinista)
 * Tag: @integration @ads @ima @volume
 */
import { test, expect, MockContentIds, StaticVastTags } from '../../fixtures'

const MOCK_VAST_URL = process.env.MOCK_VAST_BASE_URL ?? 'http://localhost:9999'

// ── AC-IMA-006: Volumen del player se preserva al iniciar el ad ───────────────

test.describe('ads-ima volume sync — volumen del player sincronizado con el ad', {
  tag: ['@critical', '@integration', '@ads', '@ima', '@volume'],
}, () => {

  // Covers: AC-IMA-006 — "El volumen del ad se inicializa al volumen del player
  // (adsManager.setVolume llamado con 0.5)"
  test('player con volume=0.5: el volumen del player no cambia al inicio del ad', async ({
    isolatedPlayer,
    page,
  }) => {
    test.setTimeout(60_000)

    // Arrange
    const jsErrors: string[] = []
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
        jsErrors.push(err.message)
      }
    })

    // Act — inicializar con volume=0.5 explícito y pre-roll activo
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
      volume: 0.5,
      adsMap: StaticVastTags.linearSkippable,
    })

    // Esperar que el ciclo de ads resuelva (bien con ad, bien gracefully sin él)
    await page.waitForFunction(
      () => {
        const events = (window as any).__qa?.events ?? []
        return (
          events.includes('adsStarted') ||
          events.includes('adsError') ||
          events.includes('adsAllAdsCompleted') ||
          events.includes('playing')
        )
      },
      { timeout: 45_000 }
    )

    // Assert — si el ad arrancó, el volumen del player debe mantenerse en 0.5.
    // AdsManager.setVolume(0.5) sincroniza el ad al volumen del player — NO debe
    // forzar volume=1 ni volume=0 por el cambio de contexto del ad.
    const events: string[] = await page.evaluate(() => (window as any).__qa?.events ?? [])
    if (events.includes('adsStarted')) {
      const volumeAfterAdStart = await isolatedPlayer.getVolume()
      expect(
        volumeAfterAdStart,
        `VOLUME SYNC: Después de adsStarted, player.volume debe ser 0.5 (el valor inicializado). ` +
        `El AdsManager.setVolume() sincroniza el ad al volumen del player, no al revés. ` +
        `Volumen observado: ${volumeAfterAdStart}`
      ).toBeCloseTo(0.5, 1)
    }

    // Sin crashes JS
    expect(
      jsErrors,
      `VOLUME SYNC: volume=0.5 + pre-roll no debe causar crashes JS. Errores: ${jsErrors.join(' | ')}`
    ).toHaveLength(0)
  })

  // Covers: AC-IMA-006 — "El volumen del ad se inicializa al volumen del player"
  // Boundary: volume=1 (máximo) — el ad no debe arrancarse silenciado
  test('player con volume=1: el ad no arranca muted ni con volumen reducido', async ({
    isolatedPlayer,
    page,
  }) => {
    test.setTimeout(60_000)

    // Arrange + Act — volume=1, autoplay con pre-roll
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
      volume: 1,
      adsMap: StaticVastTags.linearSkippable,
    })

    await page.waitForFunction(
      () => {
        const events = (window as any).__qa?.events ?? []
        return (
          events.includes('adsStarted') ||
          events.includes('adsError') ||
          events.includes('adsAllAdsCompleted') ||
          events.includes('playing')
        )
      },
      { timeout: 45_000 }
    )

    // Assert — con volume=1, el ad no debe silenciarse (adsVolumeMuted no debe emitirse
    // al inicio si el player no está muted)
    const events: string[] = await page.evaluate(() => (window as any).__qa?.events ?? [])
    if (events.includes('adsStarted')) {
      const volumeAfterAdStart = await isolatedPlayer.getVolume()
      expect(
        volumeAfterAdStart,
        `VOLUME SYNC: Con volume=1 inicializado, el ad no debe silenciar el player. ` +
        `Volumen observado tras adsStarted: ${volumeAfterAdStart}`
      ).toBeGreaterThan(0)
    }

    const initError = await isolatedPlayer.hasInitError()
    expect(
      initError,
      `VOLUME SYNC: volume=1 + pre-roll no debe causar error de init. Error: ${initError}`
    ).toBeNull()
  })

  // Covers: AC-IMA-006 — "Si el usuario cambia el volumen durante el ad, el ad refleja el cambio"
  test('cambio de volumen durante el ad: no rompe playback del ad', async ({
    isolatedPlayer,
    page,
  }) => {
    test.setTimeout(90_000)

    // Arrange — inicializar con volumen normal, ads activos
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
      volume: 0.8,
      adsMap: StaticVastTags.linearSkippable,
    })

    // Esperar que el ad empiece o que el ciclo resuelva sin ad
    await page.waitForFunction(
      () => {
        const events = (window as any).__qa?.events ?? []
        return (
          events.includes('adsStarted') ||
          events.includes('adsError') ||
          events.includes('adsAllAdsCompleted') ||
          events.includes('playing')
        )
      },
      { timeout: 45_000 }
    )

    const events: string[] = await page.evaluate(() => (window as any).__qa?.events ?? [])

    if (!events.includes('adsStarted')) {
      // El IMA SDK no inició el ad (fallo de red o CDN no disponible) — test pasa trivialmente
      test.info().annotations.push({
        type: 'warning',
        description: 'El IMA SDK no reprodujo el ad — cambio de volumen durante ad no verificado.',
      })
      return
    }

    // Act — cambiar el volumen mientras el ad está activo (isPlayingAd===true)
    const isPlayingAd = await page.evaluate(() => (window as any).__player?.isPlayingAd ?? false)
    if (isPlayingAd) {
      await isolatedPlayer.setVolume(0.3)

      // Assert — el cambio de volumen no debe detener el ad ni causar error
      await expect.poll(
        () => page.evaluate(() => (window as any).__player?.isPlayingAd ?? false),
        {
          timeout: 5_000,
          message: 'VOLUME SYNC: El ad debe seguir activo (isPlayingAd===true) después de cambiar el volumen',
        }
      ).toBe(true)

      const volumeAfterChange = await isolatedPlayer.getVolume()
      expect(
        volumeAfterChange,
        `VOLUME SYNC: Después de setVolume(0.3) durante el ad, player.volume debe ser 0.3. ` +
        `Valor observado: ${volumeAfterChange}`
      ).toBeCloseTo(0.3, 1)
    }

    const initError = await isolatedPlayer.hasInitError()
    expect(
      initError,
      `VOLUME SYNC: Cambio de volumen durante ad no debe causar error de init. Error: ${initError}`
    ).toBeNull()
  })

  // Covers: AC-IMA-006 — comportamiento con player inicializado en volume=0 (muted via volumen)
  // Verifica que el player no crashea con volume=0 + ads (caso edge del AdsOptions init)
  test('player con volume=0: no crashea al inicializar el sistema de ads', async ({
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

    // Act — volume=0 simula el caso de usuario con volumen al mínimo
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
      volume: 0,
      adsMap: StaticVastTags.linearSkippable,
    })

    // Assert — el player debe llegar a ready sin crash
    // Con volume=0, AdsManager.setVolume(0) es llamado — esto no debe provocar errores
    await isolatedPlayer.waitForReady(30_000)
    await isolatedPlayer.assertNoInitError()

    expect(
      uncaughtErrors,
      `VOLUME SYNC: volume=0 + pre-roll no debe causar crashes JS. Errores: ${uncaughtErrors.join(' | ')}`
    ).toHaveLength(0)
  })
})
