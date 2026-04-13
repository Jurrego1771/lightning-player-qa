import { test } from '../../fixtures'
import { setupPlatformMocks } from '../../fixtures/platform-mock'

test('debug view:audio ALL requests', async ({ page }) => {
  await setupPlatformMocks(page)

  const reqs: string[] = []
  page.on('request', r => {
    const u = r.url()
    if (!u.includes('cdn.mdstrm') && !u.includes('player.cdn')) reqs.push(`>> ${r.method()} ${u.replace(/\?.*/, '')}`)
  })
  page.on('response', r => {
    const u = r.url()
    if (!u.includes('cdn.mdstrm') && !u.includes('player.cdn')) reqs.push(`<< ${r.status()} ${u.replace(/\?.*/, '')}`)
  })
  page.on('requestfailed', r => reqs.push(`FAIL ${r.failure()?.errorText} ${r.url().replace(/\?.*/, '')}`))

  await page.goto('http://localhost:3000/index.html', { waitUntil: 'domcontentloaded' })
  await page.addScriptTag({ url: 'https://player.cdn.mdstrm.com/lightning_player/develop/api.js' })
  await page.waitForFunction(() => typeof (window as any).loadMSPlayer === 'function', { timeout: 15000 })

  await page.evaluate(() => {
    (window as any).__initPlayer({ type: 'media', id: 'mock-audio-1', autoplay: false, view: 'audio' })
  })

  await page.waitForTimeout(15000)

  const state = await page.evaluate(() => ({ initialized: (window as any).__qa?.initialized, initError: (window as any).__qa?.initError }))
  console.log('STATE:', JSON.stringify(state))
  reqs.forEach(r => console.log(r))
})
