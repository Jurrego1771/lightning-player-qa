import { test } from '@playwright/test'
import { MockContentIds, mockPlayerConfig, mockContentConfig } from '../../fixtures'
import { setupPlatformMocks } from '../../fixtures/platform-mock'

test('diag: podcast init hang investigation', async ({ page }) => {
  const logs: string[] = []
  page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`))
  page.on('requestfailed', req => logs.push(`[REQFAIL] ${req.url()} :: ${req.failure()?.errorText}`))
  page.on('response', resp => {
    if (resp.url().includes('mdstrm')) {
      logs.push(`[RESP] ${resp.status()} ${resp.url()}`)
    }
  })

  await setupPlatformMocks(page)
  await mockPlayerConfig(page, { view: { type: 'podcast' } })
  await mockContentConfig(page, {
    title: 'Podcast Episode Alpha',
    mediaId: MockContentIds.podcast,
    next: MockContentIds.episode,
    prev: 'mock-episode-prev',
  })

  await page.goto('http://localhost:3000/index.html', { waitUntil: 'domcontentloaded' })
  await page.addScriptTag({ url: 'https://player.cdn.mdstrm.com/lightning_player/develop/api.js' })
  await page.waitForFunction(() => typeof (window as any).loadMSPlayer === 'function', { timeout: 15_000 })

  await page.evaluate((cfg) => {
    ;(window as any).__initPlayer(cfg)
  }, { type: 'media', id: 'mock-podcast-1', autoplay: true, language: 'en' })

  await page.waitForTimeout(10_000)

  const qaState = await page.evaluate(() => JSON.stringify((window as any).__qa))
  console.log('=== QA STATE ===', qaState)
  console.log('=== LOGS ===\n' + logs.join('\n'))
}, { timeout: 30_000 })
