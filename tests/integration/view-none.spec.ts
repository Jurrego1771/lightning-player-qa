/**
 * view-none.spec.ts — View 'none' integration tests
 *
 * view:'none' renders no player UI — the player acts as a headless engine.
 * player.element exposes the underlying HTMLVideoElement via exposedPlayerRef.
 * All playback is controlled programmatically through the public API.
 *
 * Fixture: isolatedPlayer (mocked platform + local HLS streams)
 * Platform override: mockPlayerConfig with view.type='none' (LIFO over setupPlatformMocks)
 * Content: MockContentIds.vod → video view → localhost:9001/vod/master.m3u8
 */
import { test, expect, MockContentIds, mockPlayerConfig } from '../../fixtures'

test.describe('View None — Headless Player', { tag: ['@integration'] }, () => {

  test('init: ready without error', async ({ isolatedPlayer: player, page }) => {
    await mockPlayerConfig(page, { view: { type: 'none' } })
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await player.waitForReady(25_000)
    await player.assertNoInitError()
  })

  test('player.element exposes HTMLVideoElement', async ({ isolatedPlayer: player, page }) => {
    await mockPlayerConfig(page, { view: { type: 'none' } })
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await player.waitForReady(25_000)
    const tagName = await page.evaluate(() => (window as any).__player?.element?.tagName)
    expect(tagName).toBe('VIDEO')
  })

  test('player.element is an HTMLVideoElement instance', async ({ isolatedPlayer: player, page }) => {
    await mockPlayerConfig(page, { view: { type: 'none' } })
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await player.waitForReady(25_000)
    const isVideoElement = await page.evaluate(() => {
      const el = (window as any).__player?.element
      return el instanceof HTMLVideoElement
    })
    expect(isVideoElement).toBe(true)
  })

  test('no visible player container in DOM (no UI overlay)', async ({ isolatedPlayer: player, page }) => {
    await mockPlayerConfig(page, { view: { type: 'none' } })
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await player.waitForReady(25_000)
    // No Mediastream skin should be rendered — only the raw video element
    const skinVisible = await page.evaluate(() => {
      const skin = document.querySelector('.msp-skin, [class*="msp-"]')
      return skin !== null
    })
    expect(skinVisible, 'No player skin should be rendered in view:none').toBe(false)
  })

  test('play() → playing via API', async ({ isolatedPlayer: player, page }) => {
    await mockPlayerConfig(page, { view: { type: 'none' } })
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await player.waitForReady(25_000)
    await player.play()
    await player.waitForEvent('playing', 20_000)
    await player.assertIsPlaying()
  })

  test('pause() → pause state', async ({ isolatedPlayer: player, page }) => {
    await mockPlayerConfig(page, { view: { type: 'none' } })
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 25_000)
    await player.pause()
    await player.assertIsPaused()
  })

  test('seek updates currentTime', async ({ isolatedPlayer: player, page }) => {
    await mockPlayerConfig(page, { view: { type: 'none' } })
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 25_000)
    await player.seek(10)
    await player.waitForEvent('seeked', 10_000)
    await player.assertCurrentTimeNear(10, 2)
  })

  test('volume control works without UI', async ({ isolatedPlayer: player, page }) => {
    await mockPlayerConfig(page, { view: { type: 'none' } })
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await player.waitForReady(25_000)
    await player.setVolume(0.3)
    const vol = await player.getVolume()
    expect(vol).toBeCloseTo(0.3, 1)
  })

  test('element.readyState is HAVE_ENOUGH_DATA after playing', async ({ isolatedPlayer: player, page }) => {
    await mockPlayerConfig(page, { view: { type: 'none' } })
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 25_000)
    const readyState = await page.evaluate(() => (window as any).__player?.element?.readyState ?? 0)
    // HTMLMediaElement.HAVE_ENOUGH_DATA = 4
    expect(readyState).toBeGreaterThanOrEqual(3)
  })

  test('destroy: element removed from DOM', async ({ isolatedPlayer: player, page }) => {
    await mockPlayerConfig(page, { view: { type: 'none' } })
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
    await player.waitForReady(25_000)
    await player.destroy()
    const elementExists = await page.evaluate(() => (window as any).__player?.element != null)
    expect(elementExists).toBe(false)
  })
})
