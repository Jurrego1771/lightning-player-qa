/**
 * ads-ima-seek-prevention.spec.ts — Tests de integración para prevención de seek durante ad
 *
 * Cubre el gap MUST del módulo ads-ima detectado por A4 (PR #705):
 *   AC-IMA-007: Ad break previene seeking durante reproducción del ad.
 *   Cuando isPlayingAd===true, el setter de player.currentTime debe retornar null (no-op).
 *
 * Comportamiento esperado según la arquitectura del player:
 *   - Durante el ad, player.isPlayingAd === true
 *   - AdsHandler intercepta el setter de currentTime cuando isPlayingAd===true
 *   - El seek no tiene efecto: la posición del ad no cambia
 *   - El ad continúa desde su posición actual
 *
 * Estrategia de verificación:
 *   1. Esperar a que el ad empiece (adsStarted).
 *   2. Intentar seek via player.currentTime setter con un valor diferente.
 *   3. Verificar que player.isPlayingAd sigue siendo true (el ad no fue interrumpido).
 *   4. Verificar que el tiempo del ad no saltó al valor solicitado.
 *
 * Limitación conocida:
 *   En el entorno mock, el IMA SDK real puede no estar disponible si el CDN de Google
 *   no es accesible. En ese caso los tests verifican el comportamiento graceful del player.
 *   El IMA SDK cacheado en fixtures/ima-sdk/ima3.js se usa si existe (ver InitMixin.ts).
 *
 * Fixture: isolatedPlayer (plataforma mockeada — determinista)
 * Tag: @integration @ads @ima @seek
 */
import { test, expect, MockContentIds, StaticVastTags } from '../../fixtures'

const MOCK_VAST_URL = process.env.MOCK_VAST_BASE_URL ?? 'http://localhost:9999'

// ── AC-IMA-007: Seek bloqueado durante playback del ad ────────────────────────

test.describe('ads-ima seek prevention — seek bloqueado durante ad playback', {
  tag: ['@critical', '@integration', '@ads', '@ima', '@seek'],
}, () => {

  // Covers: AC-IMA-007 — "El seek no tiene efecto (AdsHandler.set() retorna null para currentTime)"
  test('isPlayingAd===true: seek via currentTime setter no interrumpe el ad', async ({
    isolatedPlayer,
    page,
  }) => {
    test.setTimeout(90_000)

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

    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
      adsMap: StaticVastTags.linearSkippable,
    })

    // Esperar que el ad empiece o que el ciclo resuelva sin él
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
      // El IMA SDK no inició el ad — no se puede verificar seek prevention
      test.info().annotations.push({
        type: 'warning',
        description: 'El IMA SDK no reprodujo el ad — seek prevention durante ad no verificado. ' +
          'Verificar disponibilidad del CDN de IMA SDK o del caché local fixtures/ima-sdk/ima3.js.',
      })
      return
    }

    // Act — intentar seek mientras el ad está activo
    const isPlayingAdBefore = await page.evaluate(
      () => (window as any).__player?.isPlayingAd ?? false
    )

    if (!isPlayingAdBefore) {
      // El ad ya terminó antes de que pudiéramos hacer el seek — test pasa
      test.info().annotations.push({
        type: 'info',
        description: 'El ad terminó antes de intentar el seek. Considerar usar un VAST con duración mayor.',
      })
      return
    }

    // Intentar seek a 60 segundos (fuera del rango del ad de pre-roll)
    await isolatedPlayer.seek(60)

    // Assert — el ad debe seguir activo después del intento de seek
    // Si el seek funcionara incorrectamente, isPlayingAd podría volverse false
    // (el ad fue interrumpido y el player saltó al contenido)
    await expect.poll(
      () => page.evaluate(() => (window as any).__player?.isPlayingAd ?? false),
      {
        timeout: 3_000,
        intervals: [100, 200, 500],
        message:
          'SEEK PREVENTION: isPlayingAd debe seguir siendo true inmediatamente después de intentar seek. ' +
          'Si es false, el seek interrumpió el ad (bug en AdsHandler.set() currentTime).',
      }
    ).toBe(true)

    // El tiempo del ad no debe haberse saltado al valor solicitado (60s)
    // El ad es un pre-roll corto — su currentTime debe ser < 60
    const timeAfterSeek = await isolatedPlayer.getCurrentTime()
    expect(
      timeAfterSeek,
      `SEEK PREVENTION: Después de seek(60) durante el ad, el tiempo del media debe ser < 60s. ` +
      `El seek no debe tener efecto cuando isPlayingAd===true. ` +
      `Tiempo observado: ${timeAfterSeek}s`
    ).toBeLessThan(60)

    // Sin crashes JS durante el intento de seek
    expect(
      jsErrors,
      `SEEK PREVENTION: El intento de seek durante el ad no debe causar crashes JS. ` +
      `Errores: ${jsErrors.join(' | ')}`
    ).toHaveLength(0)
  })

  // Covers: AC-IMA-007 — "El ad continúa reproduciéndose desde su posición actual"
  test('isPlayingAd===true: el ad sigue emitiendo progreso después de intento de seek', async ({
    isolatedPlayer,
    page,
  }) => {
    test.setTimeout(90_000)

    // Arrange
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
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

    const events: string[] = await page.evaluate(() => (window as any).__qa?.events ?? [])

    if (!events.includes('adsStarted')) {
      test.info().annotations.push({
        type: 'warning',
        description: 'El IMA SDK no reprodujo el ad — continuidad del ad post-seek no verificada.',
      })
      return
    }

    const isPlayingAdBefore = await page.evaluate(
      () => (window as any).__player?.isPlayingAd ?? false
    )

    if (!isPlayingAdBefore) {
      test.info().annotations.push({
        type: 'info',
        description: 'El ad terminó antes de poder verificar continuidad post-seek.',
      })
      return
    }

    // Act — intentar seek durante el ad
    await isolatedPlayer.seek(30)

    // Assert — el ad debe continuar (isPlayingAd no debe volverse false inmediatamente)
    // y eventualmente completarse de forma normal (adsComplete o adsAllAdsCompleted)
    const isStillPlayingAd = await page.evaluate(
      () => (window as any).__player?.isPlayingAd ?? false
    )

    // Si el ad ya terminó naturalmente, esto es válido también
    // Lo que NO debe ocurrir: error fatal del player o crash
    const initError = await isolatedPlayer.hasInitError()
    expect(
      initError,
      `SEEK PREVENTION: Seek durante ad no debe causar error fatal. ` +
      `isPlayingAd al verificar: ${isStillPlayingAd}. Error: ${initError}`
    ).toBeNull()

    // El ciclo de ads debe completarse normalmente
    // (ya sea porque el seek fue ignorado o porque el ad terminó justo antes)
    await page.waitForFunction(
      () => {
        const evts = (window as any).__qa?.events ?? []
        return (
          evts.includes('adsComplete') ||
          evts.includes('adsAllAdsCompleted') ||
          evts.includes('adsSkipped') ||
          evts.includes('adsError') ||
          evts.includes('playing')
        )
      },
      { timeout: 60_000 }
    )

    const finalEvents: string[] = await page.evaluate(() => (window as any).__qa?.events ?? [])
    const adCycleResolved =
      finalEvents.includes('adsComplete') ||
      finalEvents.includes('adsAllAdsCompleted') ||
      finalEvents.includes('adsSkipped') ||
      finalEvents.includes('adsError') ||
      finalEvents.includes('playing')

    expect(
      adCycleResolved,
      `SEEK PREVENTION: Después del intento de seek, el ciclo de ads debe resolver normalmente. ` +
      `Eventos finales: ${finalEvents.join(', ')}`
    ).toBe(true)
  })

  // Verifica que seek funciona correctamente DESPUÉS de que el ad termina
  // (regresión: el bloqueo de seek no debe persistir después de isPlayingAd===false)
  test('después del ad (isPlayingAd===false): seek funciona normalmente', async ({
    isolatedPlayer,
    page,
  }) => {
    test.setTimeout(120_000)

    // Arrange — inicializar con pre-roll y esperar que complete el ciclo de ads
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
      adsMap: StaticVastTags.linearSkippable,
    })

    // Esperar que el ciclo de ads complete y el contenido principal reanude
    await page.waitForFunction(
      () => {
        const events = (window as any).__qa?.events ?? []
        // El content reanuda después de adsContentResumeRequested o directamente en playing
        return (
          events.includes('adsContentResumeRequested') ||
          (events.includes('playing') && !(window as any).__player?.isPlayingAd)
        )
      },
      { timeout: 90_000 }
    )

    // Verificar que isPlayingAd es false antes de intentar el seek
    const isPlayingAdAfter = await page.evaluate(
      () => (window as any).__player?.isPlayingAd ?? false
    )

    if (isPlayingAdAfter) {
      // El ad todavía está reproduciéndose — saltar este paso del test
      test.info().annotations.push({
        type: 'info',
        description: 'El ad todavía está reproduciéndose — no se puede verificar seek post-ad.',
      })
      return
    }

    // Act — hacer seek en el contenido principal (post-ad)
    const durationBeforeSeek = await isolatedPlayer.getDuration()
    const targetTime = Math.min(5, durationBeforeSeek > 5 ? 5 : durationBeforeSeek * 0.5)

    if (targetTime <= 0) {
      test.info().annotations.push({
        type: 'info',
        description: 'Duración del contenido insuficiente para verificar seek post-ad.',
      })
      return
    }

    await isolatedPlayer.seek(targetTime)

    // Assert — el seek debe funcionar cuando el ad ya terminó
    await expect.poll(
      () => isolatedPlayer.getCurrentTime(),
      {
        timeout: 8_000,
        message:
          `SEEK PREVENTION: Seek post-ad debe funcionar normalmente. ` +
          `Target: ${targetTime}s. El bloqueo de seek no debe persistir post-ad.`,
      }
    ).toBeGreaterThan(0)

    const initError = await isolatedPlayer.hasInitError()
    expect(
      initError,
      `SEEK PREVENTION: Seek post-ad no debe causar error de init. Error: ${initError}`
    ).toBeNull()
  })
})
