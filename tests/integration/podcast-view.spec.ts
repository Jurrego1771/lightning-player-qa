/**
 * podcast-view.spec.ts — Podcast view integration tests
 *
 * Podcast view renders audio content with podcast-specific UI.
 * Uses type:'media' + audio content (player.type reports 'media').
 *
 * Fixture: isolatedPlayer (mocked platform + local HLS streams)
 * Platform override: mockPlayerConfig with view.type='podcast' (LIFO over setupPlatformMocks)
 * Content: MockContentIds.podcast → /audio/mock-podcast-1.json → audio.json → localhost:9001/audio/index.m3u8
 */
import { test, expect, MockContentIds, mockPlayerConfig } from '../../fixtures'

test.describe('Podcast View', { tag: ['@integration'] }, () => {

  test('init: ready without error', async ({ isolatedPlayer: player, page }) => {
    await mockPlayerConfig(page, { view: { type: 'podcast' } })
    await player.goto({ type: 'media', id: MockContentIds.podcast, autoplay: false })
    await player.waitForReady(25_000)
    await player.assertNoInitError()
  })

  test('play() → playing', async ({ isolatedPlayer: player, page }) => {
    await mockPlayerConfig(page, { view: { type: 'podcast' } })
    await player.goto({ type: 'media', id: MockContentIds.podcast, autoplay: false })
    await player.waitForReady(25_000)
    await player.play()
    await player.waitForEvent('playing', 20_000)
    await player.assertIsPlaying()
  })

  test('autoplay=true → playing', async ({ isolatedPlayer: player, page }) => {
    await mockPlayerConfig(page, { view: { type: 'podcast' } })
    await player.goto({ type: 'media', id: MockContentIds.podcast, autoplay: true })
    await player.waitForEvent('playing', 25_000)
    await player.assertIsPlaying()
  })

  test('pause() → paused after playing', async ({ isolatedPlayer: player, page }) => {
    await mockPlayerConfig(page, { view: { type: 'podcast' } })
    await player.goto({ type: 'media', id: MockContentIds.podcast, autoplay: true })
    await player.waitForEvent('playing', 25_000)
    await player.pause()
    await player.assertIsPaused()
  })

  test('isLive returns false for podcast (VOD audio)', async ({ isolatedPlayer: player, page }) => {
    await mockPlayerConfig(page, { view: { type: 'podcast' } })
    await player.goto({ type: 'media', id: MockContentIds.podcast, autoplay: false })
    await player.waitForReady(25_000)
    expect(await player.isLive()).toBe(false)
  })

  test('handler is hls for audio stream', async ({ isolatedPlayer: player, page }) => {
    await mockPlayerConfig(page, { view: { type: 'podcast' } })
    await player.goto({ type: 'media', id: MockContentIds.podcast, autoplay: false })
    await player.waitForReady(25_000)
    await player.play()
    await player.waitForEvent('playing', 20_000)
    const handler = await player.getHandler()
    expect(['hls', 'native']).toContain(handler)
  })

  test('seek to position updates currentTime', async ({ isolatedPlayer: player, page }) => {
    await mockPlayerConfig(page, { view: { type: 'podcast' } })
    await player.goto({ type: 'media', id: MockContentIds.podcast, autoplay: true })
    await player.waitForEvent('playing', 25_000)
    await player.seek(5)
    await player.waitForEvent('seeked', 10_000)
    await player.assertCurrentTimeNear(5, 2)
  })

  test('playbackRate can be changed (podcast feature)', async ({ isolatedPlayer: player, page }) => {
    await mockPlayerConfig(page, { view: { type: 'podcast' } })
    await player.goto({ type: 'media', id: MockContentIds.podcast, autoplay: false })
    await player.waitForReady(25_000)
    await player.setPlaybackRate(1.5)
    const rate = await player.getPlaybackRate()
    expect(rate).toBeCloseTo(1.5, 1)
  })

  test('destroy: no crash', async ({ isolatedPlayer: player, page }) => {
    await mockPlayerConfig(page, { view: { type: 'podcast' } })
    await player.goto({ type: 'media', id: MockContentIds.podcast, autoplay: false })
    await player.waitForReady(25_000)
    await player.destroy()
    const status = await page.evaluate(() => {
      try { return (window as any).__player?.status ?? null }
      catch { return null }
    })
    expect(['idle', undefined, null]).toContain(status)
  })
})
