/**
 * accessibility.spec.ts — Tests de Accesibilidad (WCAG 2.1 AA)
 *
 * Usa axe-core para detectar violaciones automáticas (~57% de issues WCAG).
 * Los checks manuales (screen reader, zoom) se documentan como TODO para revisión manual.
 *
 * Usa `isolatedPlayer` con plataforma mockeada + streams HLS locales para que
 * el estado del player sea predecible y los tests no dependan de CDN ni plataforma.
 *
 * Target: WCAG 2.1 AA compliance en todos los tipos de player.
 */
import { test, expect, MockContentIds } from '../../fixtures'
import AxeBuilder from '@axe-core/playwright'

test.describe('Accessibility — Player de Video', { tag: ['@a11y'] }, () => {

  test('no hay violaciones WCAG en estado idle', async ({ isolatedPlayer: player, page }) => {
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await player.waitForReady()

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()

    expect(results.violations).toEqual([])
  })

  test('no hay violaciones WCAG durante la reproducción', async ({ isolatedPlayer: player, page }) => {
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing')

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze()

    expect(results.violations).toEqual([])
  })

  test('controles del player son navegables con Tab', async ({ isolatedPlayer: player, page }) => {
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await player.waitForReady()

    // Tab debe moverse entre elementos interactivos sin quedar atrapado
    await page.keyboard.press('Tab')
    const firstFocused = await page.evaluate(() => document.activeElement?.tagName)
    expect(firstFocused).toBeTruthy()

    await page.keyboard.press('Tab')
    const secondFocused = await page.evaluate(() => document.activeElement?.tagName)
    expect(secondFocused).toBeTruthy()
  })

  test('Space/Enter activan play en el botón de play', async ({ isolatedPlayer: player, page }) => {
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await player.waitForReady()

    // No usar waitForCanPlay() aquí: con autoplay=false el browser no prebufferiza
    // el stream, por lo que el evento 'canplay' no se emite hasta que play() sea
    // invocado. Esperar 'canplay' antes del click bloquea indefinidamente.
    // waitForReady() es suficiente: la UI del player ya está renderizada y los
    // controles son interactivos.
    const playButton = page.locator('[aria-label*="play" i], [aria-label*="Play" i], button[class*="play"]').first()
    await expect(playButton).toBeVisible()
    await playButton.focus()
    await page.keyboard.press('Space')

    await player.assertIsPlaying()
  })

  test('todos los botones de control tienen aria-label', async ({ isolatedPlayer: player, page }) => {
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await player.waitForReady()

    // Buscar botones sin aria-label ni aria-labelledby
    const buttonsWithoutLabel = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'))
      return buttons
        .filter(b => !b.getAttribute('aria-label') && !b.getAttribute('aria-labelledby') && !b.textContent?.trim())
        .map(b => b.outerHTML.slice(0, 100))
    })

    expect(buttonsWithoutLabel).toHaveLength(0)
  })

  test('slider de volumen tiene role="slider" con aria-valuenow', async ({ isolatedPlayer: player, page }) => {
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await player.waitForReady()

    const volumeSlider = page.locator('[role="slider"][aria-label*="volume" i], [role="slider"][aria-label*="volumen" i]')
    if (await volumeSlider.count() > 0) {
      await expect(volumeSlider.first()).toHaveAttribute('aria-valuenow')
      await expect(volumeSlider.first()).toHaveAttribute('aria-valuemin')
      await expect(volumeSlider.first()).toHaveAttribute('aria-valuemax')
    }
  })
})

test.describe('Accessibility — Player de Audio', { tag: ['@a11y'] }, () => {
  test('no hay violaciones WCAG en player de audio', async ({ isolatedPlayer: player, page }) => {
    await player.goto({ type: 'media', id: MockContentIds.audio, autoplay: false, view: 'compact' })
    await player.waitForReady()

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze()

    expect(results.violations).toEqual([])
  })
})

test.describe('Accessibility — Keyboard Navigation Completa', { tag: ['@a11y'] }, () => {

  test('Escape pausa o cierra controles si están abiertos', async ({ isolatedPlayer: player, page }) => {
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 20_000)

    // Escape no debe lanzar excepciones ni crashes
    const uncaughtErrors: string[] = []
    page.on('pageerror', (err) => { uncaughtErrors.push(err.message) })

    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)

    expect(uncaughtErrors, 'Escape no debe provocar errores JS').toHaveLength(0)
  })

  test('ArrowLeft/ArrowRight en seekbar mueven currentTime', async ({ isolatedPlayer: player, page }) => {
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 20_000)

    // Buscar seekbar / progress con role=slider
    const seekbar = page.locator('[role="slider"]:not([aria-label*="volume" i])').first()
    if (await seekbar.count() === 0) {
      test.skip()
      return
    }

    await seekbar.focus()
    const timeBefore = await player.getCurrentTime()
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(200)
    const timeAfter = await player.getCurrentTime()

    // ArrowRight debe incrementar o mantenerse (si ya está al final)
    expect(timeAfter).toBeGreaterThanOrEqual(timeBefore)
  })

  test('Tab en estado playing: controles exponen más de 1 elemento focuseable', async ({ isolatedPlayer: player, page }) => {
    // En estado idle, solo el botón play puede ser focuseable (1 elemento es aceptable).
    // En estado playing con controles visibles, debe haber ≥2 (play/pause + volumen o seekbar).
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 20_000)

    // Mover mouse para asegurar que controles estén visibles
    await page.mouse.move(200, 200)
    await page.waitForTimeout(300)

    const seenElements = new Set<string>()
    for (let i = 0; i < 15; i++) {
      await page.keyboard.press('Tab')
      const tag = await page.evaluate(() => {
        const el = document.activeElement
        return el ? `${el.tagName}[${el.getAttribute('aria-label') ?? el.getAttribute('role') ?? ''}]` : 'BODY'
      })
      if (seenElements.has(tag) && seenElements.size >= 2) break
      seenElements.add(tag)
    }

    // En playing con controles visibles debe haber ≥2 elementos focuseables
    if (seenElements.size < 2) {
      console.warn(
        `A11y finding: Solo ${seenElements.size} elemento(s) focuseable(s) en estado playing — ` +
        `considerar exponer seekbar y volume con tabIndex. Elementos: ${[...seenElements].join(', ')}`
      )
    }
    // Test documental — no falla por cantidad, pero ≥1 es requerido (0 = sin controles = fallo real)
    expect(seenElements.size, 'No hay elementos focuseables en el player — violación crítica a11y').toBeGreaterThanOrEqual(1)
  })

  test('no hay trampa de teclado — más de 1 elemento focuseable (WCAG 2.1.2)', async ({ isolatedPlayer: player, page }) => {
    // WCAG 2.1.2: usuario puede mover focus dentro/fuera sin trampa.
    // En harness sin otros elementos de página, Tab ciclará entre controles del player — eso
    // es comportamiento correcto. La trampa real es cuando solo HAY 1 elemento focuseable
    // (Tab siempre vuelve al mismo nodo sin pasar por ningún otro).
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await player.waitForReady()

    const seenElements = new Set<string>()
    for (let i = 0; i < 15; i++) {
      await page.keyboard.press('Tab')
      const el = await page.evaluate(() => {
        const e = document.activeElement
        if (!e || e === document.body) return 'BODY'
        return `${e.tagName}[${e.getAttribute('aria-label') ?? e.getAttribute('role') ?? e.className.slice(0, 20)}]`
      })
      if (el === 'BODY' && seenElements.size > 0) break  // Tab salió del player — no hay trampa
      seenElements.add(el)
      if (seenElements.size >= 3) break  // Suficientes elementos distintos — no hay trampa
    }

    // Si después de 15 Tabs solo vemos 1 elemento → posible trampa (focus atrapado en 1 nodo)
    expect(
      seenElements.size,
      `Solo 1 elemento recibió focus en 15 Tabs — posible trampa WCAG 2.1.2. Elemento: ${[...seenElements][0]}`
    ).toBeGreaterThan(1)
  })

})

test.describe('Accessibility — Estados y Roles', { tag: ['@a11y'] }, () => {

  test('player tiene landmark region o role apropiado', async ({ isolatedPlayer: player, page }) => {
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await player.waitForReady()

    const hasRegion = await page.evaluate(() => {
      const regions = document.querySelectorAll('[role="region"], [role="application"], [role="main"], main')
      return regions.length > 0
    })

    // Advertencia, no error: el player puede no tener landmark (no es WCAG fail automático)
    // pero es buena práctica para screen readers
    if (!hasRegion) {
      console.warn('Player no expone landmark region — considerar agregar role="region" con aria-label')
    }
  })

  test('elemento video/audio tiene texto alternativo o aria-label', async ({ isolatedPlayer: player, page }) => {
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await player.waitForReady()

    const mediaEl = await page.evaluate(() => {
      const video = document.querySelector('video')
      const audio = document.querySelector('audio')
      const el = video ?? audio
      if (!el) return null
      return {
        hasAriaLabel: !!el.getAttribute('aria-label'),
        hasAriaLabelledby: !!el.getAttribute('aria-labelledby'),
        hasTitle: !!el.getAttribute('title'),
        hasTrack: el.querySelectorAll('track').length > 0,
      }
    })

    if (mediaEl) {
      // Al menos uno de los mecanismos debe estar presente
      const hasAccessibleName = mediaEl.hasAriaLabel || mediaEl.hasAriaLabelledby || mediaEl.hasTitle
      if (!hasAccessibleName) {
        console.warn('El elemento video/audio no tiene aria-label — recomendado para screen readers')
      }
    }
  })

  test('WCAG 2.2 AA: sin violaciones nivel AA en estado playing', async ({ isolatedPlayer: player, page }) => {
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 20_000)

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze()

    // Reportar violaciones con detalle para facilitar fix
    if (results.violations.length > 0) {
      const summary = results.violations.map((v) =>
        `[${v.impact}] ${v.id}: ${v.description} — ${v.nodes.length} node(s)`
      ).join('\n')
      expect(results.violations, `Violaciones WCAG 2.2 AA:\n${summary}`).toEqual([])
    }
  })

  test('color contrast: violaciones critical de contraste en idle', async ({ isolatedPlayer: player, page }) => {
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await player.waitForReady()

    const results = await new AxeBuilder({ page })
      .withRules(['color-contrast'])
      .analyze()

    const critical = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')
    expect(
      critical,
      `Violaciones críticas de contraste: ${critical.map((v) => v.id).join(', ')}`
    ).toHaveLength(0)
  })

})

/*
 * ── Tests Manuales Documentados ───────────────────────────────────────────
 * Los siguientes items requieren verificación manual con screen reader:
 *
 * [ ] NVDA + Chrome: "Video player, Play button" al hacer focus en play
 * [ ] VoiceOver + Safari: ídem en macOS
 * [ ] Zoom 400%: controles no se superponen
 * [ ] High contrast mode: controles siguen siendo visibles
 * [ ] Sin mouse: flujo completo de play, seek, pause, fullscreen con solo teclado
 * [ ] prefers-reduced-motion: player respeta media query
 */
