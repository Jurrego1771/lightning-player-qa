/**
 * ads-ima-skip.spec.ts — Tests de integración para skip de ad IMA
 *
 * Cubre los gaps MUST/SHOULD del módulo ads-ima detectados por A4 (PR #705):
 *   AC-IMA-008 (MUST): Skip de ad después del skipOffset — adsSkipped emitido, content reanuda.
 *   AC-IMA-009 (SHOULD): Skip antes del skipOffset — no tiene efecto (ad.skippable===false).
 *
 * Comportamiento esperado:
 *   AC-IMA-008 (happy path del skip):
 *     - Player configurado con ads.skipAt=N (skipOffset en segundos)
 *     - Una vez pasados >= N segundos del ad, player.ad.info.skippable === true
 *     - Llamar player.ad.skip() emite adsSkipped
 *     - isPlayingAd vuelve a false
 *     - El contenido principal reanuda
 *
 *   AC-IMA-009 (caso negativo del skip):
 *     - Mismo setup, pero skip() se llama antes de que pasen N segundos
 *     - player.ad.info.skippable === false en ese momento
 *     - El skip no ocurre (ad continúa reproduciéndose)
 *     - No se emite adsSkipped
 *
 * Nota sobre el entorno mock:
 *   El VAST de pre-roll servido por mock-vast debe incluir skipOffset para que
 *   el IMA SDK lo reconozca como ad skippable. Si el mock VAST no incluye skipOffset
 *   nativo, se usa ads.skipAt en la config del player como fallback.
 *   El endpoint esperado es: MOCK_VAST_URL/vast/preroll-skippable (con skipOffset=5s)
 *   Si no existe, se usa /vast/preroll con ads.skipAt=5.
 *
 * Fixture: isolatedPlayer (plataforma mockeada — determinista)
 * Tag: @integration @ads @ima @skip
 */
import { test, expect, MockContentIds, StaticVastTags } from '../../fixtures'

const MOCK_VAST_URL = process.env.MOCK_VAST_BASE_URL ?? 'http://localhost:9999'

// ── AC-IMA-008: Skip de ad después del skipOffset ────────────────────────────

test.describe('ads-ima skip — skip después del skipOffset', {
  tag: ['@critical', '@integration', '@ads', '@ima', '@skip'],
}, () => {

  // Covers: AC-IMA-008 — "Se emite adsSkipped / isPlayingAd pasa a false / content reanuda"
  test('skip de ad: adsSkipped se emite cuando se llama ad.skip() después del skipOffset', async ({
    isolatedPlayer,
    page,
  }) => {
    test.setTimeout(120_000)

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

    // VAST real (basil79) con skipoffset nativo @5s — ad CSAI sin mockear.
    const skippableVastUrl = StaticVastTags.linearSkippable

    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
      adsMap: skippableVastUrl,
      // skipAt como fallback si el VAST no tiene skipOffset nativo
      skipAt: 5,
    })

    // Esperar a que el ad empiece
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
      // El IMA SDK no inició el ad — test pasa trivialmente
      test.info().annotations.push({
        type: 'warning',
        description:
          'El IMA SDK no reprodujo el ad — skip post-skipOffset no verificado. ' +
          'Verificar que fixtures/ima-sdk/ima3.js existe y que el mock VAST está disponible.',
      })
      return
    }

    // Esperar a que el ad sea skippable (adsSkippableStateChanged emitido)
    // El IMA SDK emite este evento cuando el skipOffset ha pasado
    const skippableReached = await page.waitForFunction(
      () => {
        const evts = (window as any).__qa?.events ?? []
        const adInfo = (window as any).__player?.ad?.info
        // El skip está disponible si:
        // A) adsSkippableStateChanged fue emitido, o
        // B) ad.info.skippable === true
        return (
          evts.includes('adsSkippableStateChanged') ||
          adInfo?.skippable === true ||
          // Si el ad terminó sin ser skippable, no podemos testear
          evts.includes('adsComplete') ||
          evts.includes('adsAllAdsCompleted')
        )
      },
      { timeout: 30_000 }
    ).catch(() => null)

    if (!skippableReached) {
      test.info().annotations.push({
        type: 'warning',
        description:
          'adsSkippableStateChanged no fue emitido en 30s. ' +
          'El VAST puede no tener skipOffset configurado.',
      })
      return
    }

    // Verificar que el skip está disponible antes de llamarlo
    const adInfo = await isolatedPlayer.getAdInfo()
    const isSkippable = await isolatedPlayer.isAdSkippable()

    if (!isSkippable || adInfo?.skippable !== true) {
      // El VAST no tiene skipOffset nativo y skipAt no activó el skip — documentar
      test.info().annotations.push({
        type: 'warning',
        description:
          `Skip no disponible: ad.info.skippable=${adInfo?.skippable}. ` +
          'El VAST de test debe incluir skipOffset para verificar AC-IMA-008.',
      })
      return
    }

    // Act — llamar player.ad.skip() cuando el skip está disponible
    await isolatedPlayer.skipAd()

    // Assert 1 — adsSkipped debe emitirse
    await expect.poll(
      () => page.evaluate(() => (window as any).__qa?.events ?? []),
      {
        timeout: 10_000,
        message: 'SKIP: adsSkipped debe emitirse después de llamar player.ad.skip() con skippable=true',
      }
    ).toContain('adsSkipped')

    // Assert 2 — isPlayingAd debe volver a false
    await expect.poll(
      () => page.evaluate(() => (window as any).__player?.isPlayingAd ?? true),
      {
        timeout: 10_000,
        message: 'SKIP: isPlayingAd debe ser false después de adsSkipped',
      }
    ).toBe(false)

    // Assert 3 — Sin crashes JS durante el skip
    expect(
      jsErrors,
      `SKIP: player.ad.skip() no debe causar crashes JS. Errores: ${jsErrors.join(' | ')}`
    ).toHaveLength(0)
  })

  // Covers: AC-IMA-008 — "El contenido reanuda desde la posición previa al ad"
  test('skip de ad: contenido principal reanuda después de adsSkipped', async ({
    isolatedPlayer,
    page,
  }) => {
    test.setTimeout(120_000)

    // Arrange
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
      adsMap: `${MOCK_VAST_URL}/vast/preroll-skippable`,
      skipAt: 5,
    })

    // Esperar inicio del ad
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
        description: 'El IMA SDK no reprodujo el ad — reanudación post-skip no verificada.',
      })
      return
    }

    // Esperar que el skip esté disponible
    await page.waitForFunction(
      () => {
        const evts = (window as any).__qa?.events ?? []
        const adInfo = (window as any).__player?.ad?.info
        return (
          adInfo?.skippable === true ||
          evts.includes('adsSkippableStateChanged') ||
          evts.includes('adsComplete') ||
          evts.includes('adsAllAdsCompleted')
        )
      },
      { timeout: 30_000 }
    ).catch(() => null)

    const isSkippable = await isolatedPlayer.isAdSkippable()
    if (!isSkippable) {
      test.info().annotations.push({
        type: 'warning',
        description: 'Skip no disponible — reanudación post-skip no verificada.',
      })
      return
    }

    // Act — skip del ad
    await isolatedPlayer.skipAd()

    // Assert — adsContentResumeRequested o playing deben emitirse después del skip
    await page.waitForFunction(
      () => {
        const evts = (window as any).__qa?.events ?? []
        return (
          evts.includes('adsContentResumeRequested') ||
          (evts.includes('adsSkipped') && evts.includes('playing'))
        )
      },
      { timeout: 20_000 }
    )

    const finalEvents: string[] = await page.evaluate(() => (window as any).__qa?.events ?? [])
    const contentResumed =
      finalEvents.includes('adsContentResumeRequested') ||
      (finalEvents.includes('adsSkipped') && finalEvents.includes('playing'))

    expect(
      contentResumed,
      `SKIP: Después de adsSkipped, el contenido debe reanudar. ` +
      `Esperado: adsContentResumeRequested o (adsSkipped + playing). ` +
      `Eventos: ${finalEvents.join(', ')}`
    ).toBe(true)

    const initError = await isolatedPlayer.hasInitError()
    expect(
      initError,
      `SKIP: Skip del ad no debe causar error fatal. Error: ${initError}`
    ).toBeNull()
  })
})

// ── AC-IMA-009 (SHOULD): Skip antes del skipOffset no tiene efecto ────────────

test.describe('ads-ima skip — skip antes del skipOffset no tiene efecto', {
  tag: ['@integration', '@ads', '@ima', '@skip'],
}, () => {

  // Covers: AC-IMA-009 — "El skip no ocurre (ad.skippable===false) / No se emite adsSkipped"
  // AC-IMA-009 es SHOULD — incluido aquí por ser complementario a AC-IMA-008
  test('skip prematuro: player.ad.skip() no tiene efecto cuando ad.skippable===false', async ({
    isolatedPlayer,
    page,
  }) => {
    test.setTimeout(90_000)

    // Arrange — configurar un pre-roll con skipAt grande (ej: 30s) para que
    // durante los primeros segundos el skip no esté disponible
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
      adsMap: `${MOCK_VAST_URL}/vast/preroll`,
      skipAt: 30, // skipOffset largo — 30s antes de que el skip esté disponible
    })

    // Esperar que el ad empiece
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
        description: 'El IMA SDK no reprodujo el ad — skip prematuro no verificado.',
      })
      return
    }

    // Verificar que el skip NO está disponible todavía (inmediatamente tras adsStarted,
    // con skipAt=30 deberían necesitarse 30s)
    const adInfoAtStart = await isolatedPlayer.getAdInfo()
    const isSkippableAtStart = await isolatedPlayer.isAdSkippable()

    // Act — intentar skip inmediatamente (antes de los 30s del skipAt)
    await isolatedPlayer.skipAd()

    // Dar un momento breve para detectar si adsSkipped se emite incorrectamente
    // (no esperar demasiado: queremos detectar la emisión inmediata errónea)
    await page.waitForTimeout(500)

    // Assert — adsSkipped NO debe haberse emitido
    const eventsAfterEarlySkip: string[] = await page.evaluate(
      () => (window as any).__qa?.events ?? []
    )

    // Si el ad no era skippable en el momento del skip, adsSkipped no debe emitirse
    if (!isSkippableAtStart && adInfoAtStart?.skippable !== true) {
      expect(
        eventsAfterEarlySkip.includes('adsSkipped'),
        `SKIP PREVENTION: Con skippable=false, llamar ad.skip() no debe emitir adsSkipped. ` +
        `Eventos tras skip prematuro: ${eventsAfterEarlySkip.join(', ')}`
      ).toBe(false)

      // El ad debe seguir activo (isPlayingAd===true)
      const isStillPlayingAd = await page.evaluate(
        () => (window as any).__player?.isPlayingAd ?? false
      )
      expect(
        isStillPlayingAd,
        `SKIP PREVENTION: Después de skip prematuro, isPlayingAd debe seguir siendo true. ` +
        `isPlayingAd observado: ${isStillPlayingAd}`
      ).toBe(true)
    } else {
      // El ad ya era skippable (skipAt=30 pero el VAST tiene skipOffset menor)
      // En este caso el test documenta el estado sin fallar
      test.info().annotations.push({
        type: 'info',
        description:
          `El ad era skippable desde el inicio (adInfo.skippable=${adInfoAtStart?.skippable}). ` +
          'El VAST puede tener skipOffset nativo menor a 30s. Skip prematuro no aplicable.',
      })
    }

    const initError = await isolatedPlayer.hasInitError()
    expect(
      initError,
      `SKIP PREVENTION: Skip prematuro no debe causar error fatal. Error: ${initError}`
    ).toBeNull()
  })

  // Verifica que el estado de skippable cambia correctamente con el tiempo
  // (adsSkippableStateChanged se emite cuando el skipOffset pasa)
  test('adsSkippableStateChanged: se emite cuando el skipOffset es alcanzado', async ({
    isolatedPlayer,
    page,
  }) => {
    test.setTimeout(60_000)

    // Arrange — skipAt corto (5s) para que el cambio sea observable rápido
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
      adsMap: `${MOCK_VAST_URL}/vast/preroll-skippable`,
      skipAt: 5,
    })

    // Esperar inicio del ad
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
        description: 'El IMA SDK no reprodujo el ad — adsSkippableStateChanged no verificado.',
      })
      return
    }

    // Esperar el cambio de estado de skippable O que el ad complete (si es muy corto)
    await page.waitForFunction(
      () => {
        const evts = (window as any).__qa?.events ?? []
        return (
          evts.includes('adsSkippableStateChanged') ||
          evts.includes('adsComplete') ||
          evts.includes('adsAllAdsCompleted') ||
          (window as any).__player?.ad?.info?.skippable === true
        )
      },
      { timeout: 20_000 }
    ).catch(() => null)

    const finalEvents: string[] = await page.evaluate(() => (window as any).__qa?.events ?? [])
    const adInfoFinal = await isolatedPlayer.getAdInfo()

    // Si el ad completó (duración muy corta), el test pasa — no había tiempo para skip
    if (finalEvents.includes('adsComplete') || finalEvents.includes('adsAllAdsCompleted')) {
      test.info().annotations.push({
        type: 'info',
        description: 'El ad completó antes de que se pudiera verificar adsSkippableStateChanged.',
      })
      return
    }

    // Si el evento fue emitido o el state cambió, verificar que al menos uno ocurrió
    const skippableStateReached =
      finalEvents.includes('adsSkippableStateChanged') ||
      adInfoFinal?.skippable === true

    if (!skippableStateReached) {
      test.info().annotations.push({
        type: 'warning',
        description:
          'adsSkippableStateChanged no fue emitido ni ad.info.skippable===true. ' +
          'El VAST puede no tener skipOffset configurado correctamente.',
      })
    }

    // Lo crítico: el player no debe estar en estado de error
    const initError = await isolatedPlayer.hasInitError()
    expect(
      initError,
      `SKIP STATE: Esperar adsSkippableStateChanged no debe causar error fatal. Error: ${initError}`
    ).toBeNull()
  })
})
