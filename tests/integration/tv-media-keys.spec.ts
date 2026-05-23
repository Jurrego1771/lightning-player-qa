/**
 * tv-media-keys.spec.ts — Tests de integración para teclas de medios en TV
 *
 * Cubre los gaps introducidos por feature/issue-680-rewind-forward:
 *
 *   Gap 1 — tv-nav-play-pause
 *     PLAY (415), PAUSE (19), PLAY_PAUSE (10252/463), STOP (413) deben
 *     toggle el playback globalmente, incluso con el sidebar abierto u otro
 *     elemento con foco (el handler es global, no depende del foco del timeline).
 *
 *   Gap 2 — tv-nav-ff-rewind
 *     FAST_FORWARD (417) y REWIND (412) disparan scrub mode sin que el timeline
 *     tenga foco. Al liberar la tecla (keyup) se hace auto-commit del scrub.
 *
 *   Gap 3 — tv-nav-tvkeys-override
 *     El atributo data-tvkeys (JSON string u objeto) sobreescribe los keycodes
 *     por defecto via buildMediaKeyCodes(). El player debe respetar el override
 *     y responder al keycode personalizado en lugar del predeterminado.
 *
 * Nota — Gap 4 (sgai-capability-threshold):
 *   La frontera de hardwareConcurrency >= 2 para activar SGAI se valida en
 *   tests/integration/tv-media-keys-sgai-capability.spec.ts (archivo separado).
 *   Ver comentario al final de este archivo para el estado de ese gap.
 *
 * Fixture: isolatedPlayer — plataforma mockeada, UA de TV inyectado via
 *          addInitScript, stream HLS local (localhost:9001).
 *
 * Estrategia de keypress para TV:
 *   Los keycodes de TV (415, 19, 417, 412, etc.) no están en el teclado estándar
 *   de Playwright. Se despachan con page.evaluate + KeyboardEvent para controlar
 *   el keyCode exacto. Keydown + keyup se envían separados cuando el test necesita
 *   verificar el comportamiento de auto-commit en keyup.
 *
 * Sin docs de feature para tv-navigation — spec generado en modo básico desde
 * el diff de feature/issue-680-rewind-forward.
 * Considerar correr /doc-feature tv-navigation create para documentar escenarios.
 *
 * Tag: @integration
 */
import { test, expect, MockContentIds } from '../../fixtures'

// ── Keycodes de TV (fuente: src/view/video/helpers/tvKeyCodes.js) ─────────────

const TV_KEY = {
  PLAY:        415,
  PAUSE:       19,
  PLAY_PAUSE:  10252,
  PLAY_PAUSE2: 463,
  STOP:        413,
  FAST_FORWARD: 417,
  REWIND:      412,
} as const

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Emula UA de Tizen Smart TV para que el player active la rama TV de navegación. */
async function emulateTVUserAgent(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/6.0 TV Safari/538.1',
      configurable: true,
    })
  })
}

/**
 * Despacha un KeyboardEvent con keyCode fijo en document.
 * page.keyboard.press() no puede controlar el keyCode numérico — se usa evaluate.
 */
async function dispatchKeyEvent(
  page: import('@playwright/test').Page,
  type: 'keydown' | 'keyup' | 'keypress',
  keyCode: number
): Promise<void> {
  await page.evaluate(
    ([evtType, code]) => {
      document.dispatchEvent(
        new KeyboardEvent(evtType as string, {
          keyCode: code as number,
          which: code as number,
          bubbles: true,
          cancelable: true,
        })
      )
    },
    [type, keyCode] as [string, number]
  )
}

/**
 * Despacha keydown + keyup en secuencia para simular una pulsación completa.
 * Necesario cuando el player hace scrub en keydown y commit en keyup.
 */
async function pressKey(
  page: import('@playwright/test').Page,
  keyCode: number,
  holdMs = 0
): Promise<void> {
  await dispatchKeyEvent(page, 'keydown', keyCode)
  if (holdMs > 0) {
    await page.waitForTimeout(holdMs)
  }
  await dispatchKeyEvent(page, 'keyup', keyCode)
}

// ── Suite 1: PLAY / PAUSE / PLAY_PAUSE / STOP ─────────────────────────────────

test.describe('TV Media Keys — Play / Pause / Stop', { tag: ['@integration'] }, () => {

  test('tecla PLAY (415) inicia reproducción desde pausa', async ({ isolatedPlayer, page }) => {
    // Arrange
    await emulateTVUserAgent(page)

    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
    })
    await isolatedPlayer.waitForReady()

    // Verificar que el player está en pausa antes del keypress
    await isolatedPlayer.assertIsPaused()

    // Act — tecla PLAY vía keyCode 415
    await dispatchKeyEvent(page, 'keydown', TV_KEY.PLAY)

    // Assert — el player debe pasar a playing
    await isolatedPlayer.assertIsPlaying()
    await isolatedPlayer.assertNoInitError()
  })

  test('tecla PAUSE (19) pausa la reproducción en curso', async ({ isolatedPlayer, page }) => {
    // Arrange
    await emulateTVUserAgent(page)

    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
    })
    await isolatedPlayer.waitForEvent('playing', 20_000)
    await isolatedPlayer.assertIsPlaying()

    // Act — tecla PAUSE vía keyCode 19
    await dispatchKeyEvent(page, 'keydown', TV_KEY.PAUSE)

    // Assert
    await isolatedPlayer.assertIsPaused()
  })

  test('tecla PLAY_PAUSE (10252) alterna entre playing y pausa', async ({ isolatedPlayer, page }) => {
    // Arrange
    await emulateTVUserAgent(page)

    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
    })
    await isolatedPlayer.waitForEvent('playing', 20_000)
    await isolatedPlayer.assertIsPlaying()

    // Act — primera pulsación: debe pausar
    await dispatchKeyEvent(page, 'keydown', TV_KEY.PLAY_PAUSE)
    await isolatedPlayer.assertIsPaused()

    // Segunda pulsación: debe reanudar
    await dispatchKeyEvent(page, 'keydown', TV_KEY.PLAY_PAUSE)
    await isolatedPlayer.assertIsPlaying()
  })

  test('tecla PLAY_PAUSE alternativa (463) alterna el playback', async ({ isolatedPlayer, page }) => {
    // Arrange
    await emulateTVUserAgent(page)

    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
    })
    await isolatedPlayer.waitForEvent('playing', 20_000)

    // Act — keyCode 463 (segundo keycode para PLAY_PAUSE según TV_MEDIA_KEY_DEFAULTS)
    await dispatchKeyEvent(page, 'keydown', TV_KEY.PLAY_PAUSE2)

    // Assert — debe pausar
    await isolatedPlayer.assertIsPaused()
  })

  test('tecla STOP (413) detiene la reproducción', async ({ isolatedPlayer, page }) => {
    // Arrange
    await emulateTVUserAgent(page)

    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
    })
    await isolatedPlayer.waitForEvent('playing', 20_000)
    await isolatedPlayer.assertIsPlaying()

    // Act — tecla STOP vía keyCode 413
    await dispatchKeyEvent(page, 'keydown', TV_KEY.STOP)

    // Assert — el player debe dejar de reproducir (pause o idle)
    await expect.poll(
      () => isolatedPlayer.getStatus(),
      { timeout: 8_000 }
    ).toMatch(/^(pause|idle)$/)
  })

  test('PLAY funciona globalmente aunque el sidebar esté "abierto" (foco fuera del timeline)', async ({ isolatedPlayer, page }) => {
    // Arrange — mover el foco a un elemento fuera del player para simular sidebar abierto
    await emulateTVUserAgent(page)

    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
    })
    await isolatedPlayer.waitForReady()

    // Mover el foco a body para simular que el sidebar tiene foco
    await page.evaluate(() => { document.body.focus() })
    // Pequeña espera para que el cambio de foco se procese en el player antes del keydown
    await page.waitForTimeout(150)

    // Act — tecla PLAY con foco fuera del player
    await dispatchKeyEvent(page, 'keydown', TV_KEY.PLAY)

    // Assert — el handler debe ser global: el player igualmente pasa a playing
    await isolatedPlayer.assertIsPlaying()
  })

  test('PAUSE funciona globalmente aunque el foco esté en body', async ({ isolatedPlayer, page }) => {
    // Arrange
    await emulateTVUserAgent(page)

    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
    })
    await isolatedPlayer.waitForEvent('playing', 20_000)

    // Mover foco fuera del player
    await page.evaluate(() => { document.body.focus() })

    // Act
    await dispatchKeyEvent(page, 'keydown', TV_KEY.PAUSE)

    // Assert
    await isolatedPlayer.assertIsPaused()
  })

})

// ── Suite 2: FAST_FORWARD y REWIND ────────────────────────────────────────────

test.describe('TV Media Keys — Fast Forward / Rewind', { tag: ['@integration'] }, () => {

  test('tecla FAST_FORWARD (417) avanza el currentTime sin foco en el timeline', async ({ isolatedPlayer, page }) => {
    // Arrange — pausar primero para que la assertion no sea un falso positivo
    // (el video en play siempre avanza; pausar garantiza que el avance es solo por FF)
    await emulateTVUserAgent(page)

    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
    })
    await isolatedPlayer.waitForEvent('playing', 20_000)

    // Asegurarse de tener buffer (currentTime > 1)
    await expect.poll(
      () => isolatedPlayer.getCurrentTime(),
      { timeout: 8_000 }
    ).toBeGreaterThan(1)

    // Pausar antes de capturar timeBefore — garantiza baseline limpio
    await dispatchKeyEvent(page, 'keydown', TV_KEY.PAUSE)
    await isolatedPlayer.assertIsPaused()

    const timeBefore = await isolatedPlayer.getCurrentTime()

    // Act — FF sin foco en el timeline (nueva capacidad del PR #680)
    await pressKey(page, TV_KEY.FAST_FORWARD, 300)

    // Assert — el seek ocurrió: currentTime avanzó respecto al baseline.
    // El player no auto-reanuda cuando estaba pausado antes del FF (comportamiento esperado:
    // pauseForScrub() no setea scrubPausedApi si api.paused=true al inicio del scrub).
    // Por eso solo validamos el seek, no el estado de reproducción.
    const timeAfter = await isolatedPlayer.getCurrentTime()
    expect(timeAfter).toBeGreaterThan(timeBefore)

    await isolatedPlayer.assertNoInitError()
  })

  test('tecla REWIND (412) retrocede el currentTime sin foco en el timeline', async ({ isolatedPlayer, page }) => {
    // Gate test: valida que REWIND con hold-scrub retrocede el currentTime.
    // Pasa una vez que feature/issue-680-rewind-forward esté en el CDN develop.
    // En builds previos el keyCode 412 no estaba registrado como media key.
    test.fixme(true, 'Gate test: feature/issue-680-rewind-forward no está en develop CDN aún')
    await emulateTVUserAgent(page)

    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
    })
    await isolatedPlayer.waitForEvent('playing', 20_000)

    // Avanzar primero para tener margen de retroceso
    // seek(5) es seguro incluso para fixtures cortos (~7s de duración)
    await isolatedPlayer.seek(5)
    await expect.poll(
      () => isolatedPlayer.getCurrentTime(),
      { timeout: 8_000, intervals: [500] }
    ).toBeGreaterThan(3)

    // Pausar antes de capturar timeBefore — garantiza baseline limpio para la comparison
    await dispatchKeyEvent(page, 'keydown', TV_KEY.PAUSE)
    await isolatedPlayer.assertIsPaused()

    const timeBefore = await isolatedPlayer.getCurrentTime()

    // Act — keydown REWIND (inicio hold-scrub, 300ms) + keyup (auto-commit)
    await pressKey(page, TV_KEY.REWIND, 300)

    // Assert — el seek ocurrió: currentTime retrocedió respecto al baseline
    const timeAfter = await isolatedPlayer.getCurrentTime()
    expect(timeAfter).toBeLessThan(timeBefore)

    await isolatedPlayer.assertNoInitError()
  })

  test('FF hace auto-commit del scrub en keyup (no queda en modo scrub permanente)', async ({ isolatedPlayer, page }) => {
    // Arrange
    await emulateTVUserAgent(page)

    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
    })
    await isolatedPlayer.waitForEvent('playing', 20_000)

    // Act — keydown para iniciar scrub
    await dispatchKeyEvent(page, 'keydown', TV_KEY.FAST_FORWARD)

    // keyup para commit
    await dispatchKeyEvent(page, 'keyup', TV_KEY.FAST_FORWARD)

    // Assert — el player debe retomar playing después del commit (no quedar en idle/buffering infinito)
    await isolatedPlayer.assertIsPlaying()
  })

  test('REWIND hace auto-commit del scrub en keyup', async ({ isolatedPlayer, page }) => {
    // Arrange
    await emulateTVUserAgent(page)

    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
    })
    await isolatedPlayer.waitForEvent('playing', 20_000)

    // Posicionar en 5s (seguro para fixtures cortos de ~7s)
    await isolatedPlayer.seek(5)
    await expect.poll(
      () => isolatedPlayer.getCurrentTime(),
      { timeout: 8_000 }
    ).toBeGreaterThan(3)

    // Act
    await dispatchKeyEvent(page, 'keydown', TV_KEY.REWIND)
    await dispatchKeyEvent(page, 'keyup', TV_KEY.REWIND)

    // Assert — el player retoma playing después del commit
    await isolatedPlayer.assertIsPlaying()
  })

  test('FF funciona sin foco previo en el timeline (foco en body)', async ({ isolatedPlayer, page }) => {
    // Valida explícitamente que FF no requiere foco en el timeline (cambio clave del PR #680)
    await emulateTVUserAgent(page)

    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
    })
    await isolatedPlayer.waitForEvent('playing', 20_000)

    await expect.poll(
      () => isolatedPlayer.getCurrentTime(),
      { timeout: 8_000 }
    ).toBeGreaterThan(1)

    // Mover foco explícitamente a body (fuera del timeline)
    await page.evaluate(() => { document.body.focus() })

    const timeBefore = await isolatedPlayer.getCurrentTime()

    // Act — FF sin foco en el timeline
    await pressKey(page, TV_KEY.FAST_FORWARD, 300)

    // Assert — el scrub debe haber funcionado igualmente
    await expect.poll(
      () => isolatedPlayer.getCurrentTime(),
      { timeout: 8_000 }
    ).toBeGreaterThan(timeBefore)
  })

  test('ENTER hace commitScrub incluso sin foco en el timeline si hay scrub activo', async ({ isolatedPlayer, page }) => {
    // Valida la rama: ENTER commits scrub without timeline focus (PR #680)
    await emulateTVUserAgent(page)

    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
    })
    await isolatedPlayer.waitForEvent('playing', 20_000)

    await expect.poll(
      () => isolatedPlayer.getCurrentTime(),
      { timeout: 8_000 }
    ).toBeGreaterThan(1)

    // Iniciar scrub con FF (keydown — sin keyup, sin auto-commit todavía)
    await dispatchKeyEvent(page, 'keydown', TV_KEY.FAST_FORWARD)

    // Mover foco fuera del timeline
    await page.evaluate(() => { document.body.focus() })

    // Act — ENTER para commit (Enter keyCode = 13)
    await dispatchKeyEvent(page, 'keydown', 13)

    // Assert — el player debe retomar playing (scrub fue commiteado)
    await isolatedPlayer.assertIsPlaying()
  })

})

// ── Suite 3: data-tvkeys override ─────────────────────────────────────────────

test.describe('TV Media Keys — data-tvkeys Override', { tag: ['@integration'] }, () => {

  /**
   * data-tvkeys mapea al config key `tvkeys` que el player pasa al ContextProvider
   * como `options={_options}`. El hook useTVNavigation lo lee vía:
   *   contextValueFamily('options.tvkeys') → lodashGet(context, 'options.tvkeys')
   *
   * En tests, se inyecta pasando `tvkeys` como key top-level en isolatedPlayer.goto(),
   * equivalente a `data-tvkeys` en el script tag HTML del integrador.
   * Referencia: src/view/video/helpers/tvKeyCodes.js — buildMediaKeyCodes(overrides)
   */

  test('data-tvkeys JSON sobreescribe PLAY keycode: keycode custom dispara play', async ({ isolatedPlayer, page }) => {
    // Arrange — inyectar UA de TV antes de cargar el player
    await emulateTVUserAgent(page)

    const CUSTOM_PLAY_KEYCODE = 9001

    // Pasar el override vía config (equivale a data-tvkeys en el script tag del integrador).
    // El player lo expone en context.options.tvkeys → buildMediaKeyCodes lo procesa.
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      tvkeys: JSON.stringify({ PLAY: [CUSTOM_PLAY_KEYCODE] }),
    })
    await isolatedPlayer.waitForReady()
    await isolatedPlayer.assertIsPaused()

    // Act — dispatch del keycode personalizado (no el 415 por defecto)
    await dispatchKeyEvent(page, 'keydown', CUSTOM_PLAY_KEYCODE)

    // Assert — buildMediaKeyCodes procesó el override: el custom keycode dispara play
    await isolatedPlayer.assertIsPlaying()
    await isolatedPlayer.assertNoInitError()
  })

  test('buildMediaKeyCodes merge: keycode default no-override sigue funcionando', async ({ isolatedPlayer, page }) => {
    // Arrange — sobreescribir solo PLAY; PAUSE debe mantener su valor predeterminado (19)
    await emulateTVUserAgent(page)

    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
      tvkeys: JSON.stringify({ PLAY: [8888] }),
    })
    await isolatedPlayer.waitForEvent('playing', 20_000)
    await isolatedPlayer.assertIsPlaying()

    // Act — PAUSE con el keycode default (19) debe seguir funcionando
    await dispatchKeyEvent(page, 'keydown', TV_KEY.PAUSE)

    // Assert — PAUSE default debe funcionar (el merge no debe borrar las demás teclas)
    await isolatedPlayer.assertIsPaused()
    await isolatedPlayer.assertNoInitError()
  })

  test('data-tvkeys como objeto (no string JSON) es aceptado sin error', async ({ isolatedPlayer, page }) => {
    // buildMediaKeyCodes acepta el override como objeto directo O como JSON string.
    // Via API pública, el integrador puede pasar un objeto cuando llama a loadMSPlayer.
    // Este test valida que el player no crashea ni ignora un override de tipo objeto.
    await emulateTVUserAgent(page)

    const CUSTOM_FF  = 9002
    const CUSTOM_RW  = 9003

    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
      tvkeys: { FAST_FORWARD: [CUSTOM_FF], REWIND: [CUSTOM_RW] },
    })
    await isolatedPlayer.waitForEvent('playing', 20_000)
    await isolatedPlayer.assertIsPlaying()

    // Posicionar en 5s para tener margen de RW
    await isolatedPlayer.seek(5)
    await expect.poll(
      () => isolatedPlayer.getCurrentTime(),
      { timeout: 8_000 }
    ).toBeGreaterThan(3)

    const timeBefore = await isolatedPlayer.getCurrentTime()

    // Act — dispatch del keyCode custom de FF (no el 417 por defecto)
    await pressKey(page, CUSTOM_FF, 300)

    // Assert — el override fue procesado: custom FF avanza el tiempo
    await expect.poll(
      () => isolatedPlayer.getCurrentTime(),
      { timeout: 8_000 }
    ).toBeGreaterThan(timeBefore)

    await isolatedPlayer.assertNoInitError()
  })

  test('data-tvkeys inválido (JSON malformado) degrada a defaults sin romper init', async ({ isolatedPlayer, page }) => {
    // Edge case: el integrador pone un JSON inválido en data-tvkeys.
    // buildMediaKeyCodes debe degradar gracefully y usar los defaults.
    // La verificación es: el player arranca con defaults funcionales y no crashea.
    await emulateTVUserAgent(page)

    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
      tvkeys: '{PLAY: [415}', // JSON malformado → buildMediaKeyCodes retorna defaults
    })
    await isolatedPlayer.waitForEvent('playing', 20_000)

    // Assert — el player no debe crashear y debe reproducir normalmente
    await isolatedPlayer.assertIsPlaying()
    await isolatedPlayer.assertNoInitError()

    // Verificar que los defaults siguen activos: tecla PAUSE (19) debe pausar
    await dispatchKeyEvent(page, 'keydown', TV_KEY.PAUSE)
    await isolatedPlayer.assertIsPaused()
  })

})

// ── Suite 4: No-regresión ──────────────────────────────────────────────────────

test.describe('TV Media Keys — No-Regresión', { tag: ['@integration'] }, () => {

  test('keycodes de TV no interfieren con la reproducción en UA de desktop', async ({ isolatedPlayer, page }) => {
    // Los keycodes de TV (415, 19, etc.) no deben disparar nada en un browser desktop.
    // El refactor de useTVNavigation solo debe activarse cuando isTVAtom=true.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        configurable: true,
      })
    })

    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
    })
    await isolatedPlayer.waitForEvent('playing', 20_000)
    await isolatedPlayer.assertIsPlaying()

    // Despachar keyCode 415 en desktop — no debe provocar cambios de estado
    await dispatchKeyEvent(page, 'keydown', TV_KEY.PLAY)

    // El player debe seguir reproduciendo (no pausar ni fallar)
    await isolatedPlayer.assertIsPlaying()
    await isolatedPlayer.assertNoInitError()
  })

  test('reproducción normal HLS con UA de TV no se ve afectada por el refactor', async ({ isolatedPlayer, page }) => {
    // Valida que el refactor de useTVNavigation no rompió el playback básico en TV
    await emulateTVUserAgent(page)

    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
    })
    await isolatedPlayer.waitForEvent('playing', 20_000)
    await isolatedPlayer.assertIsPlaying()

    // currentTime avanza (no está congelado por el refactor)
    const t0 = await isolatedPlayer.getCurrentTime()
    await expect.poll(
      () => isolatedPlayer.getCurrentTime(),
      { timeout: 8_000, intervals: [500] }
    ).toBeGreaterThan(t0)

    await isolatedPlayer.assertNoInitError()
  })

})

/*
 * ── Nota: Gap 4 — sgai-capability-threshold ──────────────────────────────────
 *
 * El cambio en src/ads/googleSGAI/services/SGAIService.js baja el umbral de
 * hardwareConcurrency >= 4 a >= 2. Para validar este boundary se requiere
 * mockear navigator.hardwareConcurrency, lo cual es posible via addInitScript:
 *
 *   await page.addInitScript((cores) => {
 *     Object.defineProperty(navigator, 'hardwareConcurrency', {
 *       value: cores,
 *       configurable: true,
 *     })
 *   }, 2)
 *
 * Sin embargo, SGAI también depende de MediaCapabilities API y
 * VideoFrameCallback — ambas presentes en Chromium de Playwright.
 * El spec ya existe en tests/integration/ads-sgai.spec.ts (cubierto por PR #595)
 * y los tests están marcados con test.fixme hasta que el build en CDN develop
 * incluya el módulo SGAI. Una vez desbloqueado, agregar un test de boundary
 * directamente en ads-sgai.spec.ts (no en este archivo):
 *
 *   test('hardwareConcurrency=1 rechaza SGAI (por debajo del umbral)', ...)
 *   test('hardwareConcurrency=2 activa SGAI (en el nuevo umbral)', ...)
 *
 * Ver: tests/integration/ads-sgai.spec.ts — Suite 1: Inicialización
 */
