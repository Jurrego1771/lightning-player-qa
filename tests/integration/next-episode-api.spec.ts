import { test, expect, MockContentIds, mockContentConfigById } from '../../fixtures'

const DEFAULT_NEXT_ID = MockContentIds.episode
const OVERRIDE_NEXT_ID = 'mock-episode-override'

async function setupHeadlessNextEpisode(
  player: any,
  page: import('@playwright/test').Page
) {
  await mockContentConfigById(page, {
    [MockContentIds.vod]: {
      title: 'Episode Alpha',
      mediaId: MockContentIds.vod,
      next: DEFAULT_NEXT_ID,
      nextEpisodeTime: 1,
    },
    [DEFAULT_NEXT_ID]: {
      title: 'Episode Beta',
      mediaId: DEFAULT_NEXT_ID,
    },
    [OVERRIDE_NEXT_ID]: {
      title: 'Episode Gamma',
      mediaId: OVERRIDE_NEXT_ID,
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
  await player.assertNoInitError()
}

test.describe('Next Episode — Headless API', { tag: ['@integration'] }, () => {
  test('updateNextEpisode confirma override y playNext carga el episodio confirmado', async ({ isolatedPlayer: player, page }) => {
    await setupHeadlessNextEpisode(player, page)

    const duration = await player.getDuration()
    await player.seek(Math.max(0, duration - 2))
    await player.waitForEvent('nextEpisodeIncoming', 10_000)

    await player.updateNextEpisode({
      id: OVERRIDE_NEXT_ID,
      type: 'episode',
      nextEpisodeTime: 1,
    })
    await player.waitForEvent('nextEpisodeConfirmed', 5_000)

    const confirmed = await player.getEventData<{ id: string; type: string; nextEpisodeTime: number }>('nextEpisodeConfirmed')
    expect(confirmed).toEqual({
      id: OVERRIDE_NEXT_ID,
      type: 'episode',
      nextEpisodeTime: 1,
    })

    await player.clearTrackedEvents()
    const result = await player.playNext()
    expect(result).toEqual({ success: true })

    await player.waitForEvent('sourcechange', 10_000)
    await player.waitForEvent('ready', 15_000)

    const metadata = await player.getMetadata()
    expect(metadata.title).toBe('Episode Gamma')
  })

  test('keepWatching evita el autoload al terminar el contenido', async ({ isolatedPlayer: player, page }) => {
    await setupHeadlessNextEpisode(player, page)

    const duration = await player.getDuration()
    await player.seek(Math.max(0, duration - 2))
    await player.waitForEvent('nextEpisodeIncoming', 10_000)

    const result = await player.keepWatching()
    expect(result).toEqual({ success: true })
    await player.waitForEvent('nextEpisodeKeepWatching', 5_000)

    await expect.poll(() => player.hasEnded(), { timeout: 15_000 }).toBe(true)

    const events = await page.evaluate(() => (window as any).__qa.events as string[])
    expect(events).not.toContain('sourcechange')

    const metadata = await player.getMetadata()
    expect(metadata.title).toBe('Episode Alpha')
  })
})
