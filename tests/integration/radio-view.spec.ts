/**
 * radio-view.spec.ts — Radio view integration tests
 *
 * Radio view requires type:'live'. Validates:
 *   - Init without error
 *   - isLive = true
 *   - play/pause lifecycle
 *   - destroy without crash
 *
 * Fixture: isolatedPlayer (mocked platform + local HLS streams)
 * Platform override: mockPlayerConfig with view.type='radio' (LIFO over setupPlatformMocks)
 * Content: MockContentIds.live → live.json → localhost:9001/vod/master.m3u8
 */
import { test, expect, MockContentIds, mockPlayerConfig } from '../../fixtures'

test.describe('Radio View', { tag: ['@integration'] }, () => {

  test('init: ready without error', async ({ isolatedPlayer: player, page }) => {
    await mockPlayerConfig(page, { view: { type: 'radio' } })
    await player.goto({ type: 'live', id: MockContentIds.live, autoplay: false })
    await player.waitForReady(25_000)
    await player.assertNoInitError()
  })

  test('isLive returns true for radio stream', async ({ isolatedPlayer: player, page }) => {
    await mockPlayerConfig(page, { view: { type: 'radio' } })
    await player.goto({ type: 'live', id: MockContentIds.live, autoplay: false })
    await player.waitForReady(25_000)
    expect(await player.isLive()).toBe(true)
  })

  test('isDVR returns false for radio stream', async ({ isolatedPlayer: player, page }) => {
    await mockPlayerConfig(page, { view: { type: 'radio' } })
    await player.goto({ type: 'live', id: MockContentIds.live, autoplay: false })
    await player.waitForReady(25_000)
    expect(await player.isDVR()).toBe(false)
  })

  test('play() → playing', async ({ isolatedPlayer: player, page }) => {
    await mockPlayerConfig(page, { view: { type: 'radio' } })
    await player.goto({ type: 'live', id: MockContentIds.live, autoplay: false })
    await player.waitForReady(25_000)
    await player.play()
    await player.waitForEvent('playing', 20_000)
    await player.assertIsPlaying()
  })

  test('autoplay=true → playing', async ({ isolatedPlayer: player, page }) => {
    await mockPlayerConfig(page, { view: { type: 'radio' } })
    await player.goto({ type: 'live', id: MockContentIds.live, autoplay: true })
    await player.waitForEvent('playing', 25_000)
    await player.assertIsPlaying()
  })

  test('pause() → paused after playing', async ({ isolatedPlayer: player, page }) => {
    await mockPlayerConfig(page, { view: { type: 'radio' } })
    await player.goto({ type: 'live', id: MockContentIds.live, autoplay: true })
    await player.waitForEvent('playing', 25_000)
    await player.pause()
    await player.assertIsPaused()
  })

  test('play() after pause resumes playback', async ({ isolatedPlayer: player, page }) => {
    await mockPlayerConfig(page, { view: { type: 'radio' } })
    await player.goto({ type: 'live', id: MockContentIds.live, autoplay: true })
    await player.waitForEvent('playing', 25_000)
    await player.pause()
    await player.assertIsPaused()
    await player.play()
    await player.waitForEvent('playing', 15_000)
    await player.assertIsPlaying()
  })

  test('destroy: no crash, player ref becomes idle', async ({ isolatedPlayer: player, page }) => {
    await mockPlayerConfig(page, { view: { type: 'radio' } })
    await player.goto({ type: 'live', id: MockContentIds.live, autoplay: false })
    await player.waitForReady(25_000)
    await player.destroy()
    const status = await page.evaluate(() => {
      try { return (window as any).__player?.status ?? null }
      catch { return null }
    })
    expect(['idle', undefined, null]).toContain(status)
  })
})
