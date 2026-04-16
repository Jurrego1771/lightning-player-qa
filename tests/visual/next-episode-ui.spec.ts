import { test, expect, MockContentIds, mockContentConfigById } from '../../fixtures'

const NEXT_EPISODE_ID = MockContentIds.episode

const disableAnimations = async (page: import('@playwright/test').Page) => {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
      }
    `,
  })
}

async function gotoVideoNextEpisodeState(
  player: any,
  page: import('@playwright/test').Page
) {
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
    autoplay: true,
  })
  await player.waitForEvent('playing', 20_000)

  const duration = await player.getDuration()
  await player.seek(Math.max(0, duration - 0.8))
  await page.locator('.next-episode').waitFor({ state: 'visible', timeout: 10_000 })
  await disableAnimations(page)
}

test.describe('Visual Regression — Next Episode UI', { tag: ['@visual'] }, () => {
  test('overlay visible con foco inicial en "Watch Next"', async ({ isolatedPlayer: player, page }) => {
    await gotoVideoNextEpisodeState(player, page)

    await expect(page).toHaveScreenshot('next-episode-default.png', {
      maxDiffPixelRatio: 0.02,
    })
  })

  test('ArrowLeft mueve el foco visual a "Watch Credits"', async ({ isolatedPlayer: player, page }) => {
    await gotoVideoNextEpisodeState(player, page)

    await page.keyboard.press('ArrowLeft')
    await expect(page).toHaveScreenshot('next-episode-credits-focused.png', {
      maxDiffPixelRatio: 0.02,
    })
  })
})
