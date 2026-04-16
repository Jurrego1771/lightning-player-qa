import { test, expect, MockContentIds, mockContentConfigById } from '../../fixtures'
import { PerfStorage } from '../../helpers/perf-storage'

const NEXT_EPISODE_ID = MockContentIds.episode

test.describe('Performance — Next Episode Transition', { tag: ['@performance'] }, () => {
  test('playNext carga el siguiente episodio en menos de 3s', async ({ isolatedPlayer: player, page }) => {
    await mockContentConfigById(page, {
      [MockContentIds.vod]: {
        title: 'Episode Alpha',
        mediaId: MockContentIds.vod,
        next: NEXT_EPISODE_ID,
        nextEpisodeTime: 1,
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
    })
    await player.waitForEvent('playing', 20_000)

    await player.clearTrackedEvents()
    const start = Date.now()
    const result = await player.playNext()
    expect(result).toEqual({ success: true })

    await player.waitForEvent('sourcechange', 10_000)
    await player.waitForEvent('ready', 15_000)

    const transitionMs = Date.now() - start
    expect(transitionMs).toBeLessThan(3_000)

    const metadata = await player.getMetadata()
    expect(metadata.title).toBe('Episode Beta')

    PerfStorage.record('next_episode_transition', {
      transition_ms: transitionMs,
    })
  })
})
