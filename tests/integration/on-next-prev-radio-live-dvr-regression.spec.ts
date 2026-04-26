/**
 * tests/integration/on-next-prev-radio-live-dvr-regression.spec.ts
 *
 * Input esperado:
 *   Player inicializado en view 'radio' con type='live' o type='dvr'.
 *   player.onNext / player.onPrev asignados a callbacks de prueba.
 * Output esperado:
 *   - El callback onNext/onPrev NO se invoca al hacer click en Next/Prev
 *     (la lógica de override solo existe en la rama isVOD del radio metadataProvider).
 *   - El comportamiento de la rama live/DVR no se ve alterado por la presencia
 *     de onNext/onPrev en el API — los callbacks son ignorados.
 * Justificación de aserción:
 *   radio/metadataProvider.jsx solo comprueba this._api.onNext/onPrev dentro
 *   de la rama `isVOD && (nextEpisode || prevEpisode)`. En live/DVR la condición
 *   isVOD=false hace que esa rama sea inalcanzable, por lo que el callback nunca
 *   debe invocarse. Verificar que la bandera __qa.callbackFired permanece false
 *   tras el click es la señal primaria de que la rama live/DVR no fue contaminada
 *   por la lógica del feature/issue-655.
 * Señales primarias:
 *   bandera __qa.callbackFired === false tras click en Next/Prev.
 * Señales secundarias:
 *   player.isLive === true (live) / player.isDVR === true (dvr) — confirma rama activa.
 * Riesgos de falso positivo:
 *   - Si el radio view live/DVR no renderiza botones Next/Prev, el click no dispara
 *     nada y la bandera permanece false — el test pasaría aunque la implementación
 *     sea incorrecta. Mitigación: el test verifica explícitamente que el botón
 *     no está presente en live/DVR, convirtiendo la ausencia en aserción positiva.
 *   - Si el harness carga VOD en lugar de live (mock devuelve isLive=false), el
 *     override podría dispararse — el test verificaría player.isLive antes de operar.
 */

import { test, expect, MockContentIds, mockPlayerConfig, mockContentConfig } from '../../fixtures'

// ── Setup helpers ─────────────────────────────────────────────────────────────

async function setupRadioLive(
  player: InstanceType<typeof import('../../fixtures/player').LightningPlayerPage>,
  page: import('@playwright/test').Page
): Promise<void> {
  // Radio view player config
  await mockPlayerConfig(page, { view: { type: 'radio' } })

  // Live content — sin campos next/prev (live no tiene navegación episódica)
  await mockContentConfig(page, {
    title: 'QA Radio Live Stream',
    mediaId: MockContentIds.live,
  })

  // type: 'live' → isVOD=false, isLive=true en el metadataProvider de radio
  await player.goto({ type: 'live', id: MockContentIds.live, autoplay: true, language: 'en' })
  await player.waitForEvent('playing', 20_000)
  await player.assertNoInitError()
}

async function setupRadioDvr(
  player: InstanceType<typeof import('../../fixtures/player').LightningPlayerPage>,
  page: import('@playwright/test').Page
): Promise<void> {
  await mockPlayerConfig(page, { view: { type: 'radio' } })

  await mockContentConfig(page, {
    title: 'QA Radio DVR Stream',
    mediaId: MockContentIds.live,
  })

  // type: 'dvr' → isVOD=false, isDVR=true en el metadataProvider de radio
  await player.goto({ type: 'dvr', id: MockContentIds.live, autoplay: true, language: 'en' })
  await player.waitForEvent('playing', 20_000)
  await player.assertNoInitError()
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('onNext / onPrev — radio live/DVR regression (override must NOT apply)', {
  tag: ['@integration'],
}, () => {

  // ── Live branch ───────────────────────────────────────────────────────────

  test('radio live — player.isLive es true (confirma rama live activa, no VOD)', async ({ isolatedPlayer: player, page }) => {
    await setupRadioLive(player, page)

    const isLive = await player.isLive()
    expect(
      isLive,
      'player.isLive debe ser true en tipo live. ' +
      'Si es false, el metadataProvider de radio tomará la rama isVOD y el test de regresión no es válido.'
    ).toBe(true)
  })

  test('radio live — botones Next/Prev no están presentes en el DOM (live no tiene episodios)', async ({ isolatedPlayer: player, page }) => {
    await setupRadioLive(player, page)

    // Instalar callbacks para detectar cualquier invocación espuria
    await page.evaluate(() => {
      ;(window as any).__qa.callbackFired = false
      ;(window as any).__player.onNext = () => {
        ;(window as any).__qa.callbackFired = true
      }
      ;(window as any).__player.onPrev = () => {
        ;(window as any).__qa.callbackFired = true
      }
    })

    // En live/DVR el radio view no debe renderizar botones de navegación episódica.
    // La ausencia del botón es la regresión clave: si apareciera, significaría que
    // la lógica VOD fue aplicada incorrectamente al branch live/DVR.
    const nextCount = await page.locator('[aria-label="Next"]').count()
    const prevCount = await page.locator('[aria-label="Previous"]').count()

    expect(
      nextCount,
      'El botón Next no debería estar presente en radio view con contenido live (sin episodios siguiente/anterior)'
    ).toBe(0)

    expect(
      prevCount,
      'El botón Previous no debería estar presente en radio view con contenido live (sin episodios siguiente/anterior)'
    ).toBe(0)

    // Verificar adicionalmente que los callbacks no fueron invocados
    const callbackFired = await page.evaluate(() => (window as any).__qa.callbackFired)
    expect(
      callbackFired,
      'Un callback onNext/onPrev fue invocado en radio live — el override contaminó la rama live'
    ).toBe(false)
  })

  test('radio live — setear onNext no dispara el callback si no hay botón Next renderizado', async ({ isolatedPlayer: player, page }) => {
    await setupRadioLive(player, page)

    // Arrange: instalar callback con bandera
    await page.evaluate(() => {
      ;(window as any).__qa.onNextCalledInLive = false
      ;(window as any).__player.onNext = () => {
        ;(window as any).__qa.onNextCalledInLive = true
      }
      ;(window as any).__qa.events = []
    })

    // Act: intentar click en Next si existe (no debe existir en live)
    const nextBtn = page.locator('[aria-label="Next"]').first()
    const isVisible = await nextBtn.isVisible().catch(() => false)

    if (isVisible) {
      // Si por algún motivo el botón existe, hacer click y verificar que el callback NO fue invocado
      await nextBtn.click()

      // Esperar un tick para que cualquier handler síncrono haya corrido
      await expect.poll(
        () => page.evaluate(() => (window as any).__qa.onNextCalledInLive),
        {
          timeout: 3_000,
          message: 'El callback onNext fue invocado en radio live — regresión: el override no debe aplicarse fuera de la rama VOD',
        }
      ).toBe(false)
    } else {
      // El botón no existe — confirmar que el callback tampoco fue invocado espontáneamente
      const fired = await page.evaluate(() => (window as any).__qa.onNextCalledInLive)
      expect(
        fired,
        'El callback onNext fue invocado espontáneamente en radio live sin interacción del usuario'
      ).toBe(false)
    }
  })

  // ── DVR branch ────────────────────────────────────────────────────────────

  test('radio DVR — player.isDVR es true (confirma rama DVR activa, no VOD)', async ({ isolatedPlayer: player, page }) => {
    await setupRadioDvr(player, page)

    const isDvr = await player.isDVR()
    expect(
      isDvr,
      'player.isDVR debe ser true en tipo dvr. ' +
      'Si es false, el metadataProvider de radio puede tomar la rama isVOD y el test de regresión no es válido.'
    ).toBe(true)
  })

  test('radio DVR — botones Next/Prev no están presentes en el DOM (DVR no tiene episodios)', async ({ isolatedPlayer: player, page }) => {
    await setupRadioDvr(player, page)

    await page.evaluate(() => {
      ;(window as any).__qa.callbackFired = false
      ;(window as any).__player.onNext = () => {
        ;(window as any).__qa.callbackFired = true
      }
      ;(window as any).__player.onPrev = () => {
        ;(window as any).__qa.callbackFired = true
      }
    })

    const nextCount = await page.locator('[aria-label="Next"]').count()
    const prevCount = await page.locator('[aria-label="Previous"]').count()

    expect(
      nextCount,
      'El botón Next no debería estar presente en radio view con contenido DVR (sin episodios siguiente/anterior)'
    ).toBe(0)

    expect(
      prevCount,
      'El botón Previous no debería estar presente en radio view con contenido DVR (sin episodios siguiente/anterior)'
    ).toBe(0)

    const callbackFired = await page.evaluate(() => (window as any).__qa.callbackFired)
    expect(
      callbackFired,
      'Un callback onNext/onPrev fue invocado en radio DVR — el override contaminó la rama DVR'
    ).toBe(false)
  })

  test('radio DVR — setear onPrev no dispara el callback si no hay botón Prev renderizado', async ({ isolatedPlayer: player, page }) => {
    await setupRadioDvr(player, page)

    // Arrange: instalar callback con bandera
    await page.evaluate(() => {
      ;(window as any).__qa.onPrevCalledInDvr = false
      ;(window as any).__player.onPrev = () => {
        ;(window as any).__qa.onPrevCalledInDvr = true
      }
      ;(window as any).__qa.events = []
    })

    // Act: intentar click en Prev si existe (no debe existir en DVR)
    const prevBtn = page.locator('[aria-label="Previous"]').first()
    const isVisible = await prevBtn.isVisible().catch(() => false)

    if (isVisible) {
      await prevBtn.click()

      await expect.poll(
        () => page.evaluate(() => (window as any).__qa.onPrevCalledInDvr),
        {
          timeout: 3_000,
          message: 'El callback onPrev fue invocado en radio DVR — regresión: el override no debe aplicarse fuera de la rama VOD',
        }
      ).toBe(false)
    } else {
      const fired = await page.evaluate(() => (window as any).__qa.onPrevCalledInDvr)
      expect(
        fired,
        'El callback onPrev fue invocado espontáneamente en radio DVR sin interacción del usuario'
      ).toBe(false)
    }
  })

  // ── API shape no se ve afectada en live/DVR ───────────────────────────────
  //
  // Verificar que player.onNext y player.onPrev siguen siendo propiedades
  // accesibles y funcionan como getter/setter también cuando el player está
  // en modo live o DVR — el feature solo restringe el COMPORTAMIENTO del botón,
  // no la existencia de las propiedades en el API.

  test('radio live — player.onNext y player.onPrev siguen siendo propiedades writable en modo live', async ({ isolatedPlayer: player, page }) => {
    await setupRadioLive(player, page)

    const result = await page.evaluate(() => {
      const p = (window as any).__player
      const errors: string[] = []

      const fn = () => {}
      try {
        p.onNext = fn
        if (p.onNext !== fn) {
          errors.push(`onNext getter devolvió ${typeof p.onNext} en lugar de la función asignada`)
        }
        p.onNext = null
        if (p.onNext !== null) {
          errors.push(`onNext = null devolvió ${p.onNext} en lugar de null`)
        }
      } catch (e: unknown) {
        errors.push(`onNext setter lanzó en live: ${e instanceof Error ? e.message : String(e)}`)
      }

      const fn2 = () => {}
      try {
        p.onPrev = fn2
        if (p.onPrev !== fn2) {
          errors.push(`onPrev getter devolvió ${typeof p.onPrev} en lugar de la función asignada`)
        }
        p.onPrev = null
        if (p.onPrev !== null) {
          errors.push(`onPrev = null devolvió ${p.onPrev} en lugar de null`)
        }
      } catch (e: unknown) {
        errors.push(`onPrev setter lanzó en live: ${e instanceof Error ? e.message : String(e)}`)
      }

      return errors
    })

    expect(
      result,
      `Las propiedades onNext/onPrev deben funcionar como getter/setter incluso en modo live:\n${result.join('\n')}`
    ).toHaveLength(0)
  })
})
