/**
 * dash-handler-select.spec.ts — Tests de selección de handler DASH (aislados)
 *
 * Cubre tres caminos de selección en src/player/base.js / src/platform/loadConfig.js:
 *  A) Auto-detect por extensión .mpd en la URL (sin parámetro format)
 *  B) Regresión HLS — URL .m3u8 sigue usando HLS handler (sin format)
 *  C) format=dash explícito — selectedSrcType='dash' fuerza DashHandler
 *
 * Fixture: isolatedPlayer (plataforma mockeada). mock-dash-vod-1 sirve un MPD válido
 * local (localhost:9001/vod-dash/manifest.mpd) con segmentos reales.
 *
 * IMPORTANTE: el handler (DashHandler/HLSHandler) es LAZY — monta cuando la media
 * empieza a REPRODUCIRSE, no al inicializar el player. Por eso estos tests usan
 * autoplay:true y esperan 'playing' antes de leer player.handler. Con autoplay:false
 * el handler nunca monta y player.handler queda "".
 *
 * Tag: @integration
 */
import { test, expect, MockContentIds } from '../../fixtures'

test.describe('DASH Handler Selection', { tag: ['@critical', '@integration'] }, () => {

  // NOTA: no existe un test de "auto-detect por .mpd" — loadConfig.js resuelve
  // src = useDash ? mpd : (hls || mp3), y useDash solo es true con format:'dash'.
  // Sin format, src nunca es la URL .mpd, así que el auto-detect por extensión
  // (base.js:337) es inalcanzable: el default es SIEMPRE HLS y DASH es opt-in vía
  // format. Por eso solo testeamos: B (HLS default) y C (DASH explícito con format).

  test('B — regresión HLS: URL .m3u8 sigue usando HLS handler (sin format)', async ({ isolatedPlayer }) => {
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
    })

    // El HLSHandler monta al reproducir → esperar 'playing' antes de leer el handler.
    await isolatedPlayer.waitForEvent('playing', 25_000)

    await expect.poll(
      () => isolatedPlayer.page.evaluate(() => String((window as any).__player?.handler ?? '').toLowerCase()),
      {
        timeout: 15_000,
        message: 'Regresión HLS: URL .m3u8 debe usar HLS handler, no DASH — handler nunca llegó a "hls"/"native".',
      }
    ).toMatch(/hls|native/)
  })

  test('C — format=dash explícito: selectedSrcType fuerza DashHandler', async ({ isolatedPlayer }) => {
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.dashVod,
      autoplay: true,
      format: 'dash',
    } as any)

    // El DashHandler monta al reproducir → esperar 'playing' antes de leer el handler.
    await isolatedPlayer.waitForEvent('playing', 25_000)

    await expect.poll(
      () => isolatedPlayer.page.evaluate(() => String((window as any).__player?.handler ?? '').toLowerCase()),
      {
        timeout: 15_000,
        message: 'format=dash explícito no forzó DashHandler — handler nunca llegó a "dash". ' +
          'Verificar src/platform/loadConfig.js — selectedSrcType="dash" cuando format=dash.',
      }
    ).toMatch(/dash/)
  })
})
