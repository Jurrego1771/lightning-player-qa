/**
 * dash-handler-select.spec.ts — Tests de selección de handler DASH (aislados)
 *
 * Cubre tres caminos de selección en src/player/base.js / src/platform/loadConfig.js:
 *  A) Auto-detect por extensión .mpd en la URL (sin parámetro format)
 *  B) Regresión HLS — URL .m3u8 sigue usando HLS handler (sin format)
 *  C) format=dash explícito — selectedSrcType='dash' fuerza DashHandler
 *
 * Fixture: isolatedPlayer (plataforma mockeada, sin streams reales)
 * El fixture mock-dash-vod-1 sirve src.hls = src.mpd = 'localhost:9001/vod/fake.mpd'.
 * DashHandler monta (handler set en _setInnerRef) antes de que dashjs intente
 * cargar el stream — el 404 posterior es irrelevante para estos tests.
 *
 * Tag: @integration
 */
import { test, expect, MockContentIds } from '../../fixtures'

test.describe('DASH Handler Selection', { tag: ['@integration'] }, () => {

  test('A — auto-detect: URL .mpd sin format param selecciona DashHandler', async ({ isolatedPlayer }) => {
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.dashVod,
      autoplay: false,
    })

    // initialized fires after _controlsReady (Controls mounts), before lazy handler mounts.
    // Poll until handler string is set (network-free — set on _setInnerRef on component mount).
    await expect.poll(
      async () => {
        const initialized = await isolatedPlayer.page.evaluate(() => (window as any).__qa?.initialized)
        const initError = await isolatedPlayer.page.evaluate(() => (window as any).__qa?.initError)
        return initialized === true || initError != null
      },
      { timeout: 20_000 }
    ).toBe(true)

    await expect.poll(
      () => isolatedPlayer.page.evaluate(() => (window as any).__player?.handler ?? ''),
      { timeout: 15_000 }
    ).toMatch(/.+/)

    const handler = await isolatedPlayer.getHandler()
    expect(
      handler.toLowerCase(),
      `Auto-detect DASH por URL .mpd falló. Handler: '${handler}'. ` +
      'Verificar src/player/base.js getDerivedStateFromProps — urlLower.includes(".mpd").'
    ).toMatch(/dash/)
  })

  test('B — regresión HLS: URL .m3u8 sigue usando HLS handler (sin format)', async ({ isolatedPlayer }) => {
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
    })

    await isolatedPlayer.waitForReady(20_000)
    // loadedmetadata garantiza que el lazy HLS chunk montó y _handler !== null
    await isolatedPlayer.waitForEvent('loadedmetadata', 15_000)

    const handler = await isolatedPlayer.getHandler()
    expect(
      handler.toLowerCase(),
      `Regresión HLS: URL .m3u8 debe usar HLS handler, no DASH. Handler: '${handler}'.`
    ).toMatch(/hls|native/)
  })

  test('C — format=dash explícito: selectedSrcType fuerza DashHandler', async ({ isolatedPlayer }) => {
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.dashVod,
      autoplay: false,
      format: 'dash',
    } as any)

    await expect.poll(
      async () => {
        const initialized = await isolatedPlayer.page.evaluate(() => (window as any).__qa?.initialized)
        const initError = await isolatedPlayer.page.evaluate(() => (window as any).__qa?.initError)
        return initialized === true || initError != null
      },
      { timeout: 20_000 }
    ).toBe(true)

    await expect.poll(
      () => isolatedPlayer.page.evaluate(() => (window as any).__player?.handler ?? ''),
      { timeout: 15_000 }
    ).toMatch(/.+/)

    const handler = await isolatedPlayer.getHandler()
    expect(
      handler.toLowerCase(),
      `format=dash explícito debe forzar DashHandler. Handler: '${handler}'. ` +
      'Verificar src/platform/loadConfig.js — selectedSrcType="dash" cuando format=dash.'
    ).toMatch(/dash/)
  })
})
