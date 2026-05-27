import { test, expect, MockContentIds, mockContentConfigById } from '../../fixtures'

const NEXT_EPISODE_ID = MockContentIds.episode

test.describe('Smoke — Next Episode', { tag: ['@smoke'] }, () => {
  // Firefox fails under parallel load (HLS fixture server contention at localhost:9001).
  // Passes in isolation. Staging workflow already has continue-on-error for Firefox smoke.
  test('happy path headless: nextEpisodeIncoming dispara y playNext carga el siguiente episodio', async ({ isolatedPlayer: player, page, browserName }) => {
    test.skip(browserName === 'firefox', 'HLS fixture server contention under parallel load')
    await mockContentConfigById(page, {
      [MockContentIds.vod]: {
        title: 'Episode Alpha',
        mediaId: MockContentIds.vod,
      },
      [NEXT_EPISODE_ID]: {
        title: 'Episode Beta',
        mediaId: NEXT_EPISODE_ID,
      },
    })

    await player.goto({
      type: 'media',
      id: MockContentIds.vod,
      view: 'none',
      renderAs: 'video',
      autoplay: true,
      nextEpisodeId: NEXT_EPISODE_ID,
      nextEpisodeTime: 1,
    })
    await player.waitForEvent('playing', 20_000)
    await player.assertNoInitError()

    const duration = await player.getDuration()
    // Seek past the nextEpisodeTime threshold (duration - 1) so the event
    // fires immediately without requiring further playback — avoids timeout
    // in Firefox/WebKit headless where HLS re-buffering after seek is slow.
    await player.seek(Math.max(0, duration - 0.5))
    await player.waitForEvent('nextEpisodeIncoming', 20_000)

    const incoming = await player.getEventData<string>('nextEpisodeIncoming')
    expect(incoming).toBe(NEXT_EPISODE_ID)

    await player.clearTrackedEvents()
    const result = await player.playNext()
    expect(result).toEqual({ success: true })

    await player.waitForEvent('nextEpisodePlayNext', 5_000)
    await player.waitForEvent('sourcechange', 10_000)
    await player.waitForEvent('metadataloaded', 15_000)
    await player.waitForEvent('ready', 15_000)

    // Use poll: ready fires before window.__player.metadata is updated
    await expect.poll(() => player.getMetadata().then(m => m.title), { timeout: 5_000 })
      .toBe('Episode Beta')
  })
})
