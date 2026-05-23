/**
 * fullscreen-pip.spec.ts — Fullscreen and Picture-in-Picture integration tests
 *
 * player.fullscreen — get/set boolean; event: fullscreenchange; uses screenfull library
 * player.pip        — get/set boolean; events: enterpictureinpicture / leavepictureinpicture
 *
 * CI notes:
 *   - Headless Chromium does not support the Fullscreen API by default
 *     (document.fullscreenEnabled = false in headless mode).
 *   - PiP requires a user gesture and may be unsupported in headless CI.
 *   - These tests verify the API surface (properties readable, setters don't crash)
 *     and skip the actual fullscreen/PiP transition if the browser doesn't support it.
 *
 * Fixture: isolatedPlayer (mocked platform + local HLS streams)
 * Content: MockContentIds.vod (video view — fullscreen and PiP require video element)
 */
import { test, expect, MockContentIds } from '../../fixtures'

test.describe('Fullscreen API', { tag: ['@integration'] }, () => {

  test('player.fullscreen is false before entering fullscreen', async ({ isolatedPlayer: player, page }) => {
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await player.waitForReady(25_000)
    const isFullscreen = await page.evaluate(() => (window as any).__player?.fullscreen ?? false)
    expect(isFullscreen).toBe(false)
  })

  test('setFullscreen(true): does not crash the player', async ({ isolatedPlayer: player, page }) => {
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 25_000)

    // In headless CI, fullscreen request may silently fail or be rejected.
    // The player must not crash or emit an error regardless.
    await page.evaluate(() => { (window as any).__player.fullscreen = true })

    // Player must still be operational after the fullscreen attempt
    await player.assertNoInitError()
    const errors = await player.getErrors()
    const fatalErrors = errors.filter((e: any) => e?.fatal === true)
    expect(fatalErrors).toHaveLength(0)
  })

  test('setFullscreen(false) when not in fullscreen: no crash', async ({ isolatedPlayer: player, page }) => {
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await player.waitForReady(25_000)
    await player.setFullscreen(false)
    await player.assertNoInitError()
  })

  test('fullscreen toggle: enter then exit does not interrupt playback', async ({ isolatedPlayer: player, page }) => {
    // Skip if fullscreen is not supported (headless CI)
    const fullscreenEnabled = await page.evaluate(() => document.fullscreenEnabled)
    if (!fullscreenEnabled) {
      test.skip(true, 'document.fullscreenEnabled=false in this environment (headless CI)')
    }

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 25_000)

    await page.evaluate(() => { (window as any).__player.fullscreen = true })
    await player.waitForEvent('fullscreenchange', 5_000)

    await page.evaluate(() => { (window as any).__player.fullscreen = false })
    await player.waitForEvent('fullscreenchange', 5_000)

    await player.assertIsPlaying()
    await player.assertNoInitError()
  })
})

test.describe('Picture-in-Picture API', { tag: ['@integration'] }, () => {

  test('player.pip is false before entering PiP', async ({ isolatedPlayer: player, page }) => {
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await player.waitForReady(25_000)
    const isPiP = await page.evaluate(() => (window as any).__player?.pip ?? false)
    expect(isPiP).toBe(false)
  })

  test('player.pip setter exists and is a boolean property', async ({ isolatedPlayer: player, page }) => {
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await player.waitForReady(25_000)
    const descriptor = await page.evaluate(() => {
      const player = (window as any).__player
      const proto = Object.getPrototypeOf(player)
      const d = Object.getOwnPropertyDescriptor(proto, 'pip')
      return { hasSetter: typeof d?.set === 'function', hasGetter: typeof d?.get === 'function' }
    })
    expect(descriptor.hasGetter, 'player.pip must have a getter').toBe(true)
    expect(descriptor.hasSetter, 'player.pip must have a setter').toBe(true)
  })

  test('set pip=true: does not crash (may be rejected in headless)', async ({ isolatedPlayer: player, page }) => {
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 25_000)

    // PiP request may be rejected in headless without user gesture.
    // Player must not crash or emit fatal errors.
    await page.evaluate(async () => {
      try { (window as any).__player.pip = true }
      catch { /* expected in headless — not a test failure */ }
    })

    await player.assertNoInitError()
    const errors = await player.getErrors()
    const fatalErrors = errors.filter((e: any) => e?.fatal === true)
    expect(fatalErrors).toHaveLength(0)
  })

  test('PiP enter/exit cycle: playback continues', async ({ isolatedPlayer: player, page }) => {
    // Skip if PiP API is not supported
    const pipSupported = await page.evaluate(() => document.pictureInPictureEnabled)
    if (!pipSupported) {
      test.skip(true, 'PiP not supported in this environment (headless CI)')
    }

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 25_000)

    await page.evaluate(() => { (window as any).__player.pip = true })
    await player.waitForEvent('enterpictureinpicture', 5_000)

    await page.evaluate(() => { (window as any).__player.pip = false })
    await player.waitForEvent('leavepictureinpicture', 5_000)

    await player.assertIsPlaying()
    await player.assertNoInitError()
  })
})
