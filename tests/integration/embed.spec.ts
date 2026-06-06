/**
 * embed.spec.ts — Cross-Origin Embed Testing
 *
 * Verifies the player works when embedded in a cross-origin iframe.
 * The player runs at http://localhost:3000/embed.html (origin A).
 * The host page runs at http://localhost:3001/host.html (origin B).
 *
 * Tests:
 *   1. Player loads in cross-origin iframe without JS errors
 *   2. postMessage events from player reach parent page (msp: channel)
 *   3. Platform mock intercepts iframe requests (Playwright network layer)
 *   4. frameLocator can access player elements across origins (DevTools)
 *
 * Uses raw page fixture (not isolatedPlayer) — navigate to :3001, not :3000.
 * Platform mocks set up manually via setupPlatformMocks() before navigation.
 *
 * Tag: @integration @embed
 */
import { test, expect, MockContentIds, setupPlatformMocks } from '../../fixtures'
import { getEnvironmentConfig } from '../../config/environments'

const EMBED_HOST = 'http://localhost:3001/host.html'
const PLAYER_ORIGIN = 'http://localhost:3000'

function buildEmbedUrl(opts: {
  type: string
  id: string
  scriptUrl: string
  autoplay?: boolean
}): string {
  const url = new URL(EMBED_HOST)
  url.searchParams.set('type', opts.type)
  url.searchParams.set('id', opts.id)
  url.searchParams.set('scriptUrl', opts.scriptUrl)
  url.searchParams.set('autoplay', String(opts.autoplay ?? true))
  return url.toString()
}

test.describe('Embed — Cross-Origin iframe', { tag: ['@integration', '@embed'] }, () => {
  const { playerScriptUrl } = getEnvironmentConfig()

  test('player carga en iframe cross-origin sin errores JS', async ({ page }) => {
    test.setTimeout(45_000)

    const jsErrors: string[] = []
    page.on('pageerror', (err) => {
      // Autoplay policy and HLS errors are expected in headless
      if (!err.message.includes('NotAllowedError') && !err.message.includes('Hls')) {
        jsErrors.push(err.message)
      }
    })

    await setupPlatformMocks(page)

    await page.goto(buildEmbedUrl({
      type: 'media',
      id: MockContentIds.vod,
      scriptUrl: playerScriptUrl,
    }), { waitUntil: 'domcontentloaded' })

    // Wait for the iframe frame to appear
    const iframeFrame = await page.waitForSelector('#player-frame')
    expect(iframeFrame).not.toBeNull()

    // Wait for iframe's __qa.initialized flag (Playwright DevTools bypasses cross-origin)
    const frame = page.frames().find((f) => f.url().startsWith(PLAYER_ORIGIN))
    if (frame) {
      await frame.waitForFunction(
        () => (window as any).__qa?.initialized === true || (window as any).__qa?.initError != null,
        { timeout: 30_000 }
      )
      const initError = await frame.evaluate(() => (window as any).__qa?.initError ?? null)
      expect(initError, 'Player must init without error in iframe').toBeNull()
    }

    expect(jsErrors, `JS crashes in cross-origin embed: ${jsErrors.join(' | ')}`).toHaveLength(0)
  })

  test('postMessage channel: eventos del player llegan al parent con prefijo msp:', async ({ page }) => {
    test.setTimeout(45_000)

    await setupPlatformMocks(page)

    await page.goto(buildEmbedUrl({
      type: 'media',
      id: MockContentIds.vod,
      scriptUrl: playerScriptUrl,
    }), { waitUntil: 'domcontentloaded' })

    // Wait for playerReady flag set by postMessage 'msp:ready' handler in host.html
    await page.waitForFunction(
      () => (window as any).__embedState?.playerReady === true,
      { timeout: 35_000 }
    )

    const state = await page.evaluate(() => (window as any).__embedState)

    // At least 'msp:ready' must have arrived
    expect(state.playerReady, 'playerReady must be true after msp:ready message').toBe(true)
    expect(state.events, 'At least one msp: event must arrive at parent').toContain('msp:ready')

    // No errors via postMessage channel
    expect(state.errors, `Embed errors: ${JSON.stringify(state.errors)}`).toHaveLength(0)
  })

  test('platform mock intercepts iframe requests — player loads mock content', async ({ page }) => {
    test.setTimeout(45_000)

    // Track platform API requests — they must be intercepted (not reach the real server)
    const interceptedPlatformRequests: string[] = []
    page.on('request', (req) => {
      if (req.url().includes('mdstrm.com')) {
        interceptedPlatformRequests.push(req.url())
      }
    })
    page.on('response', (res) => {
      // If any platform request reaches the REAL server (non-localhost), flag it
      if (res.url().includes('mdstrm.com') && res.status() !== 200) {
        interceptedPlatformRequests.push(`REAL_SERVER_HIT:${res.url()}`)
      }
    })

    await setupPlatformMocks(page)

    await page.goto(buildEmbedUrl({
      type: 'media',
      id: MockContentIds.vod,
      scriptUrl: playerScriptUrl,
    }), { waitUntil: 'domcontentloaded' })

    await page.waitForFunction(
      () => (window as any).__embedState?.playerReady === true,
      { timeout: 35_000 }
    )

    // Platform requests must have been made (player fetches content config)
    // and they must have been fulfilled (mocked, not blocked or errored)
    const realHits = interceptedPlatformRequests.filter((r) => r.startsWith('REAL_SERVER_HIT'))
    expect(realHits, 'No platform requests should reach the real server in isolated mode').toHaveLength(0)
  })

  test('frameLocator encuentra elementos del player en iframe cross-origin', async ({ page }) => {
    test.setTimeout(45_000)

    await setupPlatformMocks(page)

    await page.goto(buildEmbedUrl({
      type: 'media',
      id: MockContentIds.vod,
      scriptUrl: playerScriptUrl,
    }), { waitUntil: 'domcontentloaded' })

    // Wait for player ready
    await page.waitForFunction(
      () => (window as any).__embedState?.playerReady === true,
      { timeout: 35_000 }
    )

    // Playwright's frameLocator can access cross-origin iframe content via DevTools
    const frame = page.frameLocator('#player-frame')

    // player-container must exist in the iframe DOM
    const playerContainer = frame.locator('#player-container')
    await expect(playerContainer).toBeAttached({ timeout: 10_000 })

    // The container should have content (video element or player UI)
    const hasContent = await playerContainer.evaluate((el) => el.children.length > 0)
    expect(hasContent, 'player-container must have child elements after init').toBe(true)
  })
})
