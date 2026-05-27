/**
 * duration-effect-ads.spec.ts — Tests de integración para el efecto de duración
 * durante y después de ads (durationEffectAtom race condition fix).
 *
 * Contexto del fix (PR fix/duration):
 *   durationEffectAtom fue corregido para NO resetear durationBaseAtom a null al
 *   terminar ads — solo lo resetea cuando playerReadyAtom es false. Además, la
 *   suscripción a isAdsPlayingAtom ahora es directa para que el efecto se re-ejecute
 *   al terminar los ads. El objetivo del fix es evitar que la duración quede congelada
 *   (usando el valor del ad en lugar del valor del contenido) cuando el ad termina.
 *
 * Gaps cubiertos (session_state.json):
 *   GAP MUST ui-video — src/view/video/atoms/duration.js
 *   Símbolos: durationEffectAtom, durationBaseAtom
 *   Evento: Events._durationchange
 *
 * Estrategia de observación:
 *   durationEffectAtom y durationBaseAtom son átomos Jotai internos — no están
 *   expuestos en la API pública. Se observan indirectamente a través de:
 *     A) player.getDuration() — refleja el valor que durationEffectAtom calcula
 *        y que durationBaseAtom almacena. Si queda congelado al valor del ad
 *        (típicamente corto: 15–30s), el bug está presente.
 *     B) Evento 'durationchange' — emitido cuando el valor de duration cambia.
 *        Si el efecto se re-ejecuta correctamente post-ad, durationchange debe
 *        emitirse con el valor del contenido (mayor que la duración del ad).
 *
 * Fixture: isolatedPlayer (plataforma mockeada — no se habla con develop.mdstrm.com)
 * VAST server: mock-vast/server.ts en localhost:9999
 *
 * Tag: @integration @ads @duration
 */
import { test, expect, MockContentIds } from '../../fixtures'

const MOCK_VAST_URL = process.env.MOCK_VAST_BASE_URL ?? 'http://localhost:9999'

// Duración máxima esperada del ad en segundos.
// Los ads de prueba del mock-vast server son cortos (15–30s).
// Si después del ad la duración del contenido sigue siendo <= esta constante,
// asumimos que durationBaseAtom quedó congelado con el valor del ad.
const MAX_AD_DURATION_S = 60

// Duración mínima esperada del contenido VOD de test (LocalStreams.hls.vod).
// El stream local de test tiene duración conocida (> 60s).
const MIN_CONTENT_DURATION_S = 60

test.describe('durationEffectAtom — lifecycle con pre-roll ad', { tag: ['@integration', '@ads', '@duration'] }, () => {

  /**
   * Caso 1: Pre-roll ad → la duración del contenido no queda congelada
   * después de que termina el ad.
   *
   * El bug: después del ad, durationBaseAtom se reseteaba a null, lo que
   * dejaba la duración congelada en el valor que tenía antes del reset (el del ad).
   * El fix: el cleanup ya no resetea a null al terminar ads.
   */
  test('pre-roll: getDuration() refleja la duración del contenido al terminar el ad, no la del ad', async ({ isolatedPlayer: player }) => {
    // Arrange
    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
      adsMap: `${MOCK_VAST_URL}/vast/preroll`,
    })

    // Esperar a que el player esté inicializado
    await player.waitForEvent('ready', 30_000)

    // Esperar inicio del ad (adsContentPauseRequested confirma que el contenido pausó
    // y el ad va a comenzar — durationEffectAtom puede haber computado duración del ad)
    await player.waitForEvent('adsContentPauseRequested', 20_000)
    await player.waitForAdStart(20_000)

    // Capturar la duración durante el ad para comparar
    const durationDuringAd = await player.getDuration()

    // Act — esperar a que todos los ads completen y el contenido reanude
    await player.waitForAllAdsComplete(120_000)
    await player.waitForEvent('adsContentResumeRequested', 15_000)

    // Assert — después del resume, la duración debe ser la del contenido (>= MIN_CONTENT_DURATION_S)
    // y NO la del ad (que era corta, <= MAX_AD_DURATION_S).
    // Usar poll porque durationEffectAtom es async (React render cycle + Jotai).
    await expect.poll(
      () => player.getDuration(),
      {
        timeout: 10_000,
        intervals: [300],
        message:
          `getDuration() debería reflejar la duración del contenido post-ad ` +
          `(>= ${MIN_CONTENT_DURATION_S}s), pero sigue retornando un valor congelado. ` +
          `Duración durante el ad: ${durationDuringAd}s. ` +
          `Posible bug: durationBaseAtom quedó congelado con el valor del ad.`,
      }
    ).toBeGreaterThanOrEqual(MIN_CONTENT_DURATION_S)
  })

  /**
   * Caso 2: La duración se actualiza correctamente al reanudar el contenido
   * post-ad (durationchange se emite con el valor del contenido).
   *
   * El fix garantiza que durationEffectAtom se re-ejecuta al terminar ads
   * (porque isAdsPlayingAtom pasa a false y el efecto recomputa).
   * Si el efecto se re-ejecuta, debe emitir Events._durationchange con el
   * nuevo valor calculado desde el HTML5 video element.
   */
  test('pre-roll: evento durationchange se emite con la duración del contenido después del ad', async ({ isolatedPlayer: player, page }) => {
    // Arrange — capturar los valores de durationchange post-resume
    const durationChanges: number[] = []
    await page.exposeFunction('__captureDuration', (value: number) => {
      durationChanges.push(value)
    })

    // Instalar listener sobre el evento 'durationchange' del player antes del goto
    await page.addInitScript(() => {
      // El harness expone window.__qa.events para rastrear eventos por nombre.
      // Necesitamos también los *valores* de durationchange.
      // Instalamos un listener adicional que llama __captureDuration con el valor.
      const originalOn = (window as any).__playerOnDuration
      // Se instala en window para que el harness lo aplique después de que
      // el player esté disponible. El harness llama window.__qa.onPlayerReady si existe.
      ;(window as any).__qa = (window as any).__qa ?? {}
      ;(window as any).__qa._durationHook = (d: number) => {
        if (typeof (window as any).__captureDuration === 'function') {
          ;(window as any).__captureDuration(d)
        }
      }
    })

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
      adsMap: `${MOCK_VAST_URL}/vast/preroll`,
    })

    // Registrar el listener sobre el player una vez que esté inicializado
    await player.waitForEvent('ready', 30_000)
    await page.evaluate(() => {
      const p = (window as any).__player
      if (p && typeof p.on === 'function') {
        p.on('durationchange', (e: unknown) => {
          const duration =
            typeof e === 'number'
              ? e
              : (e as Record<string, unknown>)?.duration as number ??
                (window as any).__player?.duration ?? 0
          if (typeof (window as any).__captureDuration === 'function') {
            ;(window as any).__captureDuration(Number(duration))
          }
        })
      }
    })

    // Esperar inicio y fin del ad
    await player.waitForEvent('adsContentPauseRequested', 20_000)
    await player.waitForAllAdsComplete(120_000)
    await player.waitForEvent('adsContentResumeRequested', 15_000)

    // Act — esperar a que el contenido retome reproducción y emita durationchange
    await player.waitForEvent('playing', 15_000)

    // Assert — durationchange se emitió con un valor >= MIN_CONTENT_DURATION_S
    // Una vez que durationEffectAtom se re-ejecuta, debe propagar la duración correcta.
    await expect.poll(
      () => durationChanges.filter((d) => d >= MIN_CONTENT_DURATION_S).length,
      {
        timeout: 10_000,
        intervals: [300],
        message:
          `Se esperaba al menos un evento durationchange con valor >= ${MIN_CONTENT_DURATION_S}s ` +
          `después de que el ad terminara. ` +
          `Valores capturados: [${durationChanges.join(', ')}]. ` +
          `Si todos los valores son <= ${MAX_AD_DURATION_S}s, durationEffectAtom no se re-ejecutó.`,
      }
    ).toBeGreaterThanOrEqual(1)
  })

  /**
   * Caso 3 (edge case): La duración no se congela si el ad termina mientras
   * el durationEffectAtom todavía estaba sincronizando (isAdsPlayingAtom cambia
   * a false antes de que el efecto haya computado el valor final).
   *
   * Escenario: ads muy cortos (< 1 ciclo de render) + autoplay immediato.
   * Con el fix, la suscripción directa a isAdsPlayingAtom garantiza que el efecto
   * se re-ejecuta incluso si la transición fue rápida. Sin el fix, la duración
   * podría quedar en 0 o NaN (reset anticipado a null) o en el valor del ad.
   */
  test('edge case: getDuration() es valido (> 0, no NaN, no congelado en valor de ad) cuando el ad termina rapido', async ({ isolatedPlayer: player, page }) => {
    // Arrange — escuchar errores no capturados para detectar crashes en el efecto
    const uncaughtErrors: string[] = []
    page.on('pageerror', (err) => {
      // Filtrar ruido conocido (autoplay policy, abort de red, HLS warnings)
      const msg = err.message.toLowerCase()
      if (
        !msg.includes('notallowederror') &&
        !msg.includes('aborted') &&
        !msg.includes('play()') &&
        !msg.includes('the play() request was interrupted') &&
        !msg.includes('hls')
      ) {
        uncaughtErrors.push(err.message)
      }
    })

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
      // Usar VAST de preroll — puede ser corto si el mock server tiene un ad de <5s
      adsMap: `${MOCK_VAST_URL}/vast/preroll`,
    })

    await player.waitForEvent('ready', 30_000)

    // Esperar a que el ciclo de ads complete (incluyendo ads muy cortos)
    await player.waitForAllAdsComplete(120_000)
    await player.waitForEvent('adsContentResumeRequested', 15_000)

    // Esperar a que el contenido reanude reproducción para que durationEffectAtom
    // tenga al menos un ciclo de render para recomputar el valor
    await player.waitForEvent('playing', 15_000)

    // Assert A — sin crashes no capturados durante el ciclo de ads
    expect(
      uncaughtErrors,
      `durationEffectAtom no debe lanzar errores JavaScript no capturados durante el lifecycle de ads. ` +
      `Errores detectados: ${uncaughtErrors.join(' | ')}`
    ).toHaveLength(0)

    // Assert B — la duración es un valor numérico válido (> 0, no NaN, no congelado en ad)
    const durationPostAd = await player.getDuration()

    expect(
      isNaN(durationPostAd),
      `getDuration() retornó NaN después de que el ad terminó. ` +
      `El fix debe garantizar que durationBaseAtom no quede en null si playerReadyAtom sigue siendo true.`
    ).toBe(false)

    expect(
      durationPostAd,
      `getDuration() retornó 0 después de que el ad terminó — durationBaseAtom puede haber sido ` +
      `reseteado a null prematuramente (el bug que el fix corrige).`
    ).toBeGreaterThan(0)

    expect(
      durationPostAd,
      `getDuration() retornó un valor <= ${MAX_AD_DURATION_S}s post-ad, que es el rango de duración ` +
      `de los ads de test. Posible congelación: durationBaseAtom quedó con el valor del ad en lugar ` +
      `del contenido. El efecto debería haberse re-ejecutado al cambiar isAdsPlayingAtom a false.`
    ).toBeGreaterThanOrEqual(MIN_CONTENT_DURATION_S)

    // Assert C — la propiedad isPlayingAd es false (ads ya terminaron)
    const isPlayingAd = await page.evaluate(() => (window as any).__player?.isPlayingAd ?? false)
    expect(
      isPlayingAd,
      `player.isPlayingAd debería ser false después de adsAllAdsCompleted + adsContentResumeRequested.`
    ).toBe(false)
  })

})

test.describe('durationEffectAtom — no-regresion: contenido sin ads', { tag: ['@integration', '@duration'] }, () => {

  /**
   * No-regresion: sin ads, la duración del contenido sigue siendo correcta.
   * El fix no debe afectar el comportamiento cuando isAdsPlayingAtom nunca cambia.
   */
  test('VOD sin ads: getDuration() retorna un valor valido desde el inicio', async ({ isolatedPlayer: player }) => {
    // Arrange
    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
    })

    await player.waitForEvent('ready', 30_000)
    await player.waitForEvent('playing', 20_000)

    // Assert — duración disponible y correcta desde el primer ciclo
    await expect.poll(
      () => player.getDuration(),
      {
        timeout: 10_000,
        intervals: [300],
        message:
          `getDuration() debería retornar un valor >= ${MIN_CONTENT_DURATION_S}s en VOD sin ads. ` +
          `El fix al cleanup de durationEffectAtom no debe interferir con el flujo sin ads.`,
      }
    ).toBeGreaterThanOrEqual(MIN_CONTENT_DURATION_S)

    // El player sigue reproduciendo sin interrupciones
    await player.assertIsPlaying()
    await player.assertNoInitError()
  })

})
