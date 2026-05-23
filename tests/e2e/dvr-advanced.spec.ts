/**
 * dvr-advanced.spec.ts — DVR advanced E2E tests (HLS)
 *
 * live-playback.spec.ts already covers: isDVR=true, seekable rewind.
 * dash-dvr.spec.ts covers DASH DVR seek scenarios.
 * This file covers HLS DVR-specific properties and behaviors:
 *   - player.edge (distance to live edge in seconds)
 *   - isLive vs isDVR distinction
 *   - Pause → resume maintains position within DVR window
 *   - DVR window has measurable seekable range
 *   - player.seekable reflects the DVR window
 *
 * Fixture: player (real DEV infra)
 * Requires: contentAccess fixture (single-use tokens from platform API)
 */
import { test, expect, ContentIds } from '../../fixtures'

test.describe('DVR Advanced — HLS', { tag: ['@e2e', '@dvr'] }, () => {

  test('isDVR=true, isLive=false for dvr type', async ({ player, contentAccess }) => {
    await player.goto({ type: 'dvr', id: ContentIds.dvr, autoplay: true, ...contentAccess.dvr })
    await player.waitForEvent('playing', 30_000)

    expect(await player.isDVR()).toBe(true)
    expect(await player.isLive()).toBe(false)
  })

  test('player.edge is a positive number (distance to live edge)', async ({ player, page, contentAccess }) => {
    await player.goto({ type: 'dvr', id: ContentIds.dvr, autoplay: true, ...contentAccess.dvr })
    await player.waitForEvent('playing', 30_000)

    const edge = await page.evaluate(() => (window as any).__player?.edge ?? null)
    // edge may be null if not yet computed — wait for it to be populated
    await expect.poll(
      () => page.evaluate(() => (window as any).__player?.edge ?? null),
      { timeout: 10_000, message: 'player.edge should become available after playing starts' }
    ).not.toBeNull()

    const edgeValue = await page.evaluate(() => (window as any).__player?.edge ?? -1)
    expect(typeof edgeValue).toBe('number')
    expect(edgeValue).toBeGreaterThanOrEqual(0)
  })

  test('seekable range reflects DVR window (length > 0)', async ({ player, page, contentAccess }) => {
    await player.goto({ type: 'dvr', id: ContentIds.dvr, autoplay: true, ...contentAccess.dvr })
    await player.waitForEvent('playing', 30_000)
    // Allow DVR window to accumulate segments
    await page.waitForTimeout(3_000)

    const seekableLength = await page.evaluate(() => {
      const v = document.querySelector('video')
      return v?.seekable.length ?? 0
    })
    expect(seekableLength, 'DVR stream must have seekable ranges').toBeGreaterThan(0)
  })

  test('pause → resume keeps position within DVR window', async ({ player, page, contentAccess }) => {
    await player.goto({ type: 'dvr', id: ContentIds.dvr, autoplay: true, ...contentAccess.dvr })
    await player.waitForEvent('playing', 30_000)

    const posBefore = await player.getCurrentTime()
    await player.pause()
    await player.assertIsPaused()

    // Time should not advance while paused
    await page.waitForTimeout(2_000)
    const posWhilePaused = await player.getCurrentTime()
    expect(Math.abs(posWhilePaused - posBefore)).toBeLessThan(1.5)

    await player.play()
    await player.waitForEvent('playing', 15_000)
    await player.assertIsPlaying()
    // After resume, currentTime should advance from the paused position
    const posAfter = await player.getCurrentTime()
    expect(posAfter).toBeGreaterThanOrEqual(posWhilePaused)
  })

  test('seek back in DVR window then player reaches playing state', async ({ player, page, contentAccess }) => {
    await player.goto({ type: 'dvr', id: ContentIds.dvr, autoplay: true, ...contentAccess.dvr })
    await player.waitForEvent('playing', 30_000)
    await page.waitForTimeout(5_000)

    const seekableStart = await page.evaluate(() => {
      const v = document.querySelector('video')
      return v?.seekable.length ? v.seekable.start(0) : -1
    })

    if (seekableStart < 0) {
      test.skip(true, 'DVR window not yet available — seekable range empty')
    }

    const target = seekableStart + 5
    await player.seek(target)
    await player.waitForEvent('seeked', 15_000)

    await expect.poll(
      () => player.getStatus(),
      { timeout: 20_000, message: 'Player must reach playing or buffering state after DVR seek' }
    ).toMatch(/playing|buffering/)

    await player.assertNoInitError()
  })

  test('currentTime advances during DVR playback', async ({ player, page, contentAccess }) => {
    await player.goto({ type: 'dvr', id: ContentIds.dvr, autoplay: true, ...contentAccess.dvr })
    await player.waitForEvent('playing', 30_000)

    const t1 = await player.getCurrentTime()
    await expect.poll(
      () => player.getCurrentTime(),
      { timeout: 8_000 }
    ).toBeGreaterThan(t1)
  })

  test('handler is hls for DVR stream', async ({ player, contentAccess }) => {
    await player.goto({ type: 'dvr', id: ContentIds.dvr, autoplay: true, ...contentAccess.dvr })
    await player.waitForEvent('playing', 30_000)
    const handler = await player.getHandler()
    expect(handler).toBe('hls')
  })
})
