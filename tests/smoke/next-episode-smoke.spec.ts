import { test, expect, MockContentIds, mockContentConfigById } from '../../fixtures'

const NEXT_EPISODE_ID = MockContentIds.episode

test.describe('Smoke — Next Episode', { tag: ['@smoke'] }, () => {
  test('happy path headless: nextEpisodeIncoming dispara y playNext carga el siguiente episodio', async ({ isolatedPlayer: player, page }) => {
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
    await player.seek(Math.max(0, duration - 2))
    await player.waitForEvent('nextEpisodeIncoming', 10_000)

    const incoming = await player.getEventData<string>('nextEpisodeIncoming')
    expect(incoming).toBe(NEXT_EPISODE_ID)

    await player.clearTrackedEvents()
    const result = await player.playNext()
    expect(result).toEqual({ success: true })

    await player.waitForEvent('nextEpisodePlayNext', 5_000)
    await player.waitForEvent('sourcechange', 10_000)
    await player.waitForEvent('metadataloaded', 15_000)
    await player.waitForEvent('ready', 15_000)

    const metadata = await player.getMetadata()
    expect(metadata.title).toBe('Episode Beta')
  })
})
