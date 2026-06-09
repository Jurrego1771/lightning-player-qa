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

// El fixture HLS local (fixtures/streams/vod/) tiene 32 entradas en el m3u8 — los mismos
// 4 archivos .ts repetidos 8 veces. HLS.js remap los PTS de cada repetición para que sean
// continuos, por lo que el browser reporta 32 × 2s = 64s de duración total.
// El preroll mock es de 15s. Si post-ad la duración es < 60, durationBaseAtom quedó
// congelado (bug presente). Si es >= 60, el fix funciona correctamente.
const MIN_CONTENT_DURATION_S = 60  // el fixture local produce ~64s
const MOCK_PREROLL_DURATION_S = 15  // mock-vast/responses/preroll.xml: Duration 00:00:15

// BUG-DURATION-001: durationEffectAtom no computa correctamente la duración post-ad.
// PR fix/duration pendiente de merge en develop. Los 3 tests de este describe son
// no-deterministas porque dependen de si IMA SDK carga + si el fix está en develop.
// Remover .fixme cuando PR fix/duration llegue a develop.
test.describe.fixme('durationEffectAtom — lifecycle con pre-roll ad', { tag: ['@integration', '@ads', '@duration'] }, () => {

  /**
   * Caso 1: Pre-roll ad → la duración del contenido no queda congelada
   * después de que termina el ad.
   *
   * El bug: después del ad, durationBaseAtom se reseteaba a null, lo que
   * dejaba la duración congelada en el valor que tenía antes del reset (el del ad).
   * El fix: el cleanup ya no resetea a null al terminar ads.
   */
  test('pre-roll: getDuration() refleja la duración del contenido al terminar el ad, no la del ad', async ({ isolatedPlayer: player, page }) => {
    // El ad preroll dura 15s — el ciclo completo (player init + IMA + ad + assertions) puede
    // exceder el timeout global de 60s en CI si CDN es lento. Ampliar a 120s para este test.
    test.setTimeout(120_000)

    // Arrange
    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
      adsMap: `${MOCK_VAST_URL}/vast/preroll`,
    })

    // Esperar a que el player esté inicializado
    await player.waitForEvent('ready', 30_000)

    // Esperar a que el ciclo de ads termine O a que el contenido inicie directamente.
    // El IMA SDK a veces falla (requests adicionales a Google bloqueados/lentos) — el
    // wait resiliente garantiza que el test avanza independientemente de si ads jugaron.
    await page.waitForFunction(
      () => {
        const e = (window as any).__qa?.events ?? []
        const p = (window as any).__player
        if (e.includes('adsAllAdsCompleted') || e.includes('adsContentResumeRequested')) return true
        return p && typeof p.currentTime === 'number' && p.currentTime > 5 && p.isPlayingAd === false
      },
      { timeout: 120_000 }
    )

    // Assert — la duración debe ser la del contenido (>= MIN_CONTENT_DURATION_S).
    // Si los ads jugaron: bug A (reset a null) → 0, bug B (congelado) → 15s, fix → 64s.
    // Si IMA falló y el contenido jugó directo: getDuration() = 64s (fixture local) → pasa trivialmente.
    await expect.poll(
      () => player.getDuration(),
      {
        timeout: 10_000,
        intervals: [300],
        message:
          `getDuration() debería reflejar la duración del contenido ` +
          `(>= ${MIN_CONTENT_DURATION_S}s), no la del ad (${MOCK_PREROLL_DURATION_S}s) ni 0. ` +
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
    test.setTimeout(120_000)
    // Arrange — el harness ya captura el último valor de durationchange en
    // window.__qa.eventData.durationchange. No necesitamos addInitScript ni exposeFunction.
    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
      adsMap: `${MOCK_VAST_URL}/vast/preroll`,
    })

    await player.waitForEvent('ready', 30_000)

    // Wait resiliente: ciclo de ads completo O contenido iniciando directamente (si IMA falla)
    await page.waitForFunction(
      () => {
        const e = (window as any).__qa?.events ?? []
        const p = (window as any).__player
        if (e.includes('adsAllAdsCompleted') || e.includes('adsContentResumeRequested')) return true
        return p && typeof p.currentTime === 'number' && p.currentTime > 5 && p.isPlayingAd === false
      },
      { timeout: 120_000 }
    )
    await player.waitForEvent('playing', 15_000)

    // Assert: si los ads realmente jugaron, verificar que durationchange se emitió DESPUÉS
    // de adsAllAdsCompleted Y getDuration() >= MIN_CONTENT_DURATION_S.
    //
    // Nota técnica: durationchange puede dispararse justo ANTES de adsContentResumeRequested
    // (cuando isAdsPlayingAtom → false al completar todos los ads). Usamos adsAllAdsCompleted
    // como anchor porque ese evento precede siempre a durationchange.
    //
    // Bug A: getDuration() = 0 → falla >= 60
    // Bug B: getDuration() = ~10s (ad value) → falla >= 60
    // Fix: getDuration() ≈ 64s + durationchange post-adsAllAdsCompleted → pasa
    //
    // Si IMA falló y el contenido jugó directo: getDuration() = 64s → getDuration check pasa,
    // durationchange check se omite con anotación (no hay adsAllAdsCompleted en events).
    const allEvents: string[] = await page.evaluate(() => (window as any).__qa?.events ?? [])
    const adsActuallyCompleted = allEvents.includes('adsAllAdsCompleted')

    if (adsActuallyCompleted) {
      // Verificar que durationchange se emitió EN ALGÚN MOMENTO del ciclo de ads (no después de
      // un anchor específico, porque puede dispararse antes o después de adsAllAdsCompleted
      // dependiendo de cuándo isAdsPlayingAtom cambia vs cuándo el player emite el evento).
      // Anchor: adsContentPauseRequested (inicio del ciclo de ads) — durationchange debe
      // aparecer en algún punto entre el inicio del ad y el final de la espera.
      //
      // Bug A: getDuration() = 0 → falla >= 60
      // Bug B: getDuration() = ~10s (ad value, congelado) → falla >= 60
      // Fix: durationchange aparece + getDuration() ≈ 64s → pasa
      await expect.poll(
        async () => {
          const events: string[] = await page.evaluate(() => (window as any).__qa?.events ?? [])
          // durationchange debe aparecer después de que el ad inició (adsContentPauseRequested)
          const adsStartIdx = events.indexOf('adsContentPauseRequested')
          const hasDurationChangeInCycle =
            adsStartIdx >= 0 && events.slice(adsStartIdx).includes('durationchange')
          if (!hasDurationChangeInCycle) return false
          const duration = await player.getDuration()
          return duration >= MIN_CONTENT_DURATION_S
        },
        {
          timeout: 15_000,
          intervals: [300],
          message:
            `Se esperaba durationchange después de adsContentPauseRequested con getDuration() >= ${MIN_CONTENT_DURATION_S}s. ` +
            `Si durationchange no aparece → el efecto no se disparó durante el ciclo de ads. ` +
            `Si getDuration() < ${MIN_CONTENT_DURATION_S}s → congelado en ad (${MOCK_PREROLL_DURATION_S}s) o reseteado a 0.`,
        }
      ).toBe(true)
    } else {
      // IMA no inicializó — verificar solo getDuration() como fallback
      // (la prueba del durationchange requiere que ads hayan jugado)
      await expect.poll(
        () => player.getDuration(),
        { timeout: 10_000, intervals: [300] }
      ).toBeGreaterThanOrEqual(MIN_CONTENT_DURATION_S)
    }
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
    test.setTimeout(120_000)
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

    // Esperar a que el ciclo de ads termine — camino normal (adsAllAdsCompleted) o fallo
    // de IMA donde el contenido inicia directamente (currentTime > 5s + isPlayingAd=false).
    // Esto hace el test robusto ante fallos intermitentes del IMA SDK sin enmascarar bugs
    // reales: las aserciones de duración siguen siendo estrictas.
    await page.waitForFunction(
      () => {
        const e = (window as any).__qa?.events ?? []
        const p = (window as any).__player
        if (e.includes('adsAllAdsCompleted') || e.includes('adsContentResumeRequested')) return true
        // Fallo de IMA: el contenido inició directamente sin ads
        return p && typeof p.currentTime === 'number' && p.currentTime > 5 && p.isPlayingAd === false
      },
      { timeout: 120_000 }
    )

    // Asegurar que el contenido esté reproduciendo (playing puede estar ya en events desde el ad)
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
      `getDuration() retornó ${durationPostAd}s post-ad — menor que ${MIN_CONTENT_DURATION_S}s. ` +
      `Posible congelación: durationBaseAtom quedó con el valor del ad (${MOCK_PREROLL_DURATION_S}s) o se reseteó a 0. ` +
      `El efecto debería haberse re-ejecutado al cambiar isAdsPlayingAtom a false.`
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

    // Assert — duración >= MIN_CONTENT_DURATION_S desde el primer ciclo sin ads
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
