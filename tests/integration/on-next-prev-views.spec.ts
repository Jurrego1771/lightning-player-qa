/**
 * tests/integration/on-next-prev-views.spec.ts
 *
 * Comportamiento del override onNext/onPrev validado en los 4 views que lo implementan:
 * compact, podcast, podcast2, radio (rama VOD).
 *
 * Comportamiento bajo test (idéntico en los 4 views):
 *   - Con override activo: callback invocado, sourcechange NO emitido.
 *   - Null-restore: sourcechange emitido (comportamiento default reactiva).
 *
 * Tests view-específicos al final de cada sección:
 *   - compact: onNext y onPrev son setters independientes.
 *   - podcast: PureComponent refleja el setter actual entre clicks (no cachea en constructor).
 *   - radio-vod: isLive === false confirma rama VOD activa.
 *   - radio-vod: sin nextEpisode en metadata, botón Next no existe en DOM.
 *
 * Contrato API setter/getter → on-next-prev-api.spec.ts
 * Regresión live/DVR → on-next-prev-radio-live-dvr-regression.spec.ts
 */

import { test, expect, MockContentIds, mockPlayerConfig, mockContentConfig } from '../../fixtures'
import type { LightningPlayerPage } from '../../fixtures/player'
import type { Page } from '@playwright/test'

// ── Configuración por view ────────────────────────────────────────────────────

const VIEW_CONFIGS = [
  { label: 'compact',   viewType: 'compact',   contentId: MockContentIds.vod,     gotoType: 'media' as const },
  { label: 'podcast',   viewType: 'podcast',   contentId: MockContentIds.podcast,  gotoType: 'media' as const },
  { label: 'podcast2',  viewType: 'podcast2',  contentId: MockContentIds.podcast,  gotoType: 'media' as const },
  { label: 'radio-vod', viewType: 'radio',     contentId: MockContentIds.vod,     gotoType: 'media' as const },
] as const

// ── Setup helper ──────────────────────────────────────────────────────────────

async function setupViewWithEpisodes(
  player: LightningPlayerPage,
  page: Page,
  cfg: { viewType: string; contentId: string; gotoType: 'media' }
): Promise<void> {
  await mockPlayerConfig(page, { view: { type: cfg.viewType } })
  await mockContentConfig(page, {
    mediaId: cfg.contentId,
    next: MockContentIds.episode,
    prev: 'mock-episode-prev',
    nextEpisodeTime: 30,
  })
  await player.goto({ type: cfg.gotoType, id: cfg.contentId, autoplay: true, language: 'en' })
  await player.waitForEvent('playing', 20_000)
  await player.assertNoInitError()
}

// ── Comportamientos comunes (parametrizados por view) ─────────────────────────

for (const cfg of VIEW_CONFIGS) {
  test.describe(`onNext / onPrev — ${cfg.label} view`, {
    tag: ['@integration'],
  }, () => {

    test(`${cfg.label} — onNext override: callback invocado, sourcechange suprimido`, async ({ isolatedPlayer: player, page }) => {
      await setupViewWithEpisodes(player, page, cfg)

      await page.evaluate(() => {
        ;(window as any).__qa.callbackFired = false
        ;(window as any).__player.onNext = () => { ;(window as any).__qa.callbackFired = true }
        ;(window as any).__qa.events = []
      })

      await page.locator('[aria-label="Next"]').first().click()

      await expect.poll(
        () => page.evaluate(() => (window as any).__qa.callbackFired),
        { timeout: 5_000, message: `callback onNext no invocado en ${cfg.label} view` }
      ).toBe(true)

      const events: string[] = await page.evaluate(() => (window as any).__qa.events ?? [])
      expect(events, `sourcechange emitido en ${cfg.label} con onNext activo — override no suprimió la carga`).not.toContain('sourcechange')
    })

    test(`${cfg.label} — onPrev override: callback invocado, sourcechange suprimido`, async ({ isolatedPlayer: player, page }) => {
      await setupViewWithEpisodes(player, page, cfg)

      await page.evaluate(() => {
        ;(window as any).__qa.callbackFired = false
        ;(window as any).__player.onPrev = () => { ;(window as any).__qa.callbackFired = true }
        ;(window as any).__qa.events = []
      })

      await page.locator('[aria-label="Previous"]').first().click()

      await expect.poll(
        () => page.evaluate(() => (window as any).__qa.callbackFired),
        { timeout: 5_000, message: `callback onPrev no invocado en ${cfg.label} view` }
      ).toBe(true)

      const events: string[] = await page.evaluate(() => (window as any).__qa.events ?? [])
      expect(events, `sourcechange emitido en ${cfg.label} con onPrev activo — override no suprimió la carga`).not.toContain('sourcechange')
    })

    test(`${cfg.label} — null-restore de onNext: sourcechange emitido (default reactiva)`, async ({ isolatedPlayer: player, page }) => {
      await setupViewWithEpisodes(player, page, cfg)

      await page.evaluate(() => {
        ;(window as any).__player.onNext = () => {}
        ;(window as any).__player.onNext = null
        ;(window as any).__qa.events = []
      })

      await page.locator('[aria-label="Next"]').first().click()

      await expect.poll(
        () => page.evaluate(() => (window as any).__qa.events as string[]),
        { timeout: 15_000, message: `sourcechange no emitido tras null-restore de onNext en ${cfg.label} view` }
      ).toContain('sourcechange')
    })

  })
}

// ── Tests view-específicos ─────────────────────────────────────────────────────

test.describe('onNext / onPrev — compact view (específico)', {
  tag: ['@integration'],
}, () => {

  test('compact — onNext y onPrev son setters independientes', async ({ isolatedPlayer: player, page }) => {
    await setupViewWithEpisodes(player, page, VIEW_CONFIGS[0])

    const result = await page.evaluate(() => {
      const p = (window as any).__player
      const fn = () => {}
      p.onNext = fn
      return {
        onNextIsFunction: typeof p.onNext === 'function',
        onPrevIsNull:     p.onPrev === null,
        onNextIsSameFn:   p.onNext === fn,
      }
    })

    expect(result.onNextIsFunction, 'player.onNext no es function').toBe(true)
    expect(result.onPrevIsNull, 'player.onPrev no es null — setter no es independiente').toBe(true)
    expect(result.onNextIsSameFn, 'player.onNext no conservó la misma referencia').toBe(true)
  })

})

test.describe('onNext / onPrev — podcast view (específico)', {
  tag: ['@integration'],
}, () => {

  // PureComponent en podcast lee props.api.onNext en cada invocación de goNext().
  // Verificar que el valor actual del setter se usa siempre, no un valor cacheado
  // en el constructor del componente.
  test('podcast — PureComponent usa valor actual del setter entre clicks', async ({ isolatedPlayer: player, page }) => {
    await setupViewWithEpisodes(player, page, VIEW_CONFIGS[1])

    await page.evaluate(() => {
      ;(window as any).__qa.callCount = 0
      ;(window as any).__player.onNext = () => { ;(window as any).__qa.callCount++ }
    })

    await page.locator('[aria-label="Next"]').first().click()
    await expect.poll(
      () => page.evaluate(() => (window as any).__qa.callCount),
      { timeout: 5_000 }
    ).toBe(1)

    await page.evaluate(() => {
      ;(window as any).__player.onNext = () => { ;(window as any).__qa.callCount += 10 }
    })

    await page.locator('[aria-label="Next"]').first().click()
    await expect.poll(
      () => page.evaluate(() => (window as any).__qa.callCount),
      { timeout: 5_000, message: 'PureComponent puede estar cacheando el callback del constructor' }
    ).toBe(11)
  })

})

test.describe('onNext / onPrev — radio view VOD branch (específico)', {
  tag: ['@integration'],
}, () => {

  test('radio-vod — player.isLive es false (confirma rama VOD activa en metadataProvider)', async ({ isolatedPlayer: player, page }) => {
    await setupViewWithEpisodes(player, page, VIEW_CONFIGS[3])

    const isLive = await player.isLive()
    expect(
      isLive,
      'player.isLive debería ser false con type=media. Si true, el radio metadataProvider usará rama live/DVR y el override no aplica.'
    ).toBe(false)
  })

  test('radio-vod — sin nextEpisode en metadata, botón Next no está en DOM', async ({ isolatedPlayer: player, page }) => {
    await mockPlayerConfig(page, { view: { type: 'radio' } })
    await mockContentConfig(page, {
      mediaId: MockContentIds.vod,
      // next omitido intencionalmente
    })

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true, language: 'en' })
    await player.waitForEvent('playing', 20_000)
    await player.assertNoInitError()

    const nextCount = await page.locator('[aria-label="Next"]').count()
    expect(nextCount, 'Botón Next presente cuando no hay nextEpisode en metadata').toBe(0)
  })

})
