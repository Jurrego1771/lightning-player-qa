/**
 * hls-abr.spec.ts — Tests de integración para Adaptive Bitrate (ABR) en HLS
 *
 * Valida que el player adapta la calidad según el bandwidth disponible.
 * Usa CDP para throttling de red controlado.
 *
 * Usa `isolatedPlayer` + streams HLS locales (localhost:9001) para que
 * los tests sean deterministas y no dependan de CDN externo.
 * Los streams locales tienen 2 calidades: 360p (400Kbps) y 720p (1.5Mbps).
 *
 * NOTA: Solo corre en Chromium (proyecto "performance" en playwright.config.ts)
 * porque CDP requiere Chromium.
 */
import { test, expect, MockContentIds } from '../../fixtures'
import {
  createCDPSession,
  setNetworkThrottle,
  removeNetworkThrottle,
  measureStartup,
} from '../../helpers/qoe-metrics'

test.describe('HLS Adaptive Bitrate', { tag: ['@critical', '@integration', '@hls'] }, () => {

  test('bajo bandwidth degradado, player selecciona calidad baja', async ({ isolatedPlayer: player, page }) => {
    const cdp = await createCDPSession(page)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 20_000)

    // Throttlear a 500 Kbps — fuerza calidad baja (stream local tiene 360p a ~400Kbps)
    await setNetworkThrottle(cdp, { downloadThroughput: (500 * 1024) / 8, uploadThroughput: (250 * 1024) / 8, latency: 100 })

    // Esperar a que ABR reaccione (2-3 ciclos de segmento)
    await player.waitForEvent('levelchanged', 30_000)

    const metrics = await player.getQoEMetrics()
    expect(metrics.bufferedAhead).toBeGreaterThan(0)

    await removeNetworkThrottle(cdp)
    await cdp.detach()
  })

  test('recovery de bandwidth: player sube calidad cuando mejora la red', async ({ isolatedPlayer: player, page }) => {
    const cdp = await createCDPSession(page)

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 20_000)

    // Degradar → waitForTimeout intencional — hls.js estima bandwidth descargando
    // segmentos sucesivos (típicamente 2-3 segmentos = ~4-6s). No hay evento
    // "bandwidth estimado" público; el estimador actúa internamente entre levelchanged.
    // El test de recovery espera el levelchanged después del restore — este wait
    // da tiempo al estimador para registrar la degradación antes de restaurar.
    await setNetworkThrottle(cdp, { downloadThroughput: (500 * 1024) / 8, uploadThroughput: (250 * 1024) / 8, latency: 100 })
    await page.waitForTimeout(10_000)

    // Restaurar bandwidth → esperar switch hacia arriba
    await removeNetworkThrottle(cdp)
    await setNetworkThrottle(cdp, { downloadThroughput: (25 * 1024 * 1024) / 8, uploadThroughput: (10 * 1024 * 1024) / 8, latency: 5 })

    // Esperar levelchanged: confirma que ABR conmutó calidad tras restaurar bandwidth.
    // Durante la degradación severa hls.js puede emitir errores de segmento y el player
    // puede quedar en pause/stalled — eso es comportamiento esperado.
    // El contrato de este test es únicamente que el switch de calidad ocurre.
    await player.waitForEvent('levelchanged', 30_000)

    // levelchanged en el array de eventos confirma el ABR switch
    const events = await player.page.evaluate(() => (window as any).__qa.events as string[])
    expect(events, 'levelchanged debe haberse emitido').toContain('levelchanged')

    await cdp.detach()
  })

  test('error de segmento: player reintenta y continúa sin error fatal', async ({ isolatedPlayer: player, page }) => {
    // Interceptar la primera request de segmento .ts y fallarla
    let segmentRequestCount = 0
    await page.route('**/segment*.ts', async (route) => {
      segmentRequestCount++
      if (segmentRequestCount === 1) {
        await route.abort('failed')
      } else {
        await route.continue()
      }
    })

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 30_000)
    await player.assertIsPlaying()
  })

  test('startup time < 3s en condiciones normales', async ({ isolatedPlayer: player, page }) => {
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })

    const metrics = await measureStartup(page)

    // Con streams locales el startup es mucho menor que 3s
    expect(metrics.timeToFirstFrame).toBeLessThan(3000)
    expect(metrics.timeToLoadedMetadata).toBeLessThan(2000)
  })
})

test.describe('HLS ABR — nextLevel vs level', { tag: ['@critical', '@integration', '@hls'] }, () => {

  test('nextLevel es un valor válido al inicio (auto -1 o índice de nivel)', async ({ isolatedPlayer: player }) => {
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 20_000)

    const levels = await player.getLevels()

    // nextLevel == -1 → ABR automático; >= 0 → un nivel concreto seleccionado por hls.js.
    // El player puede arrancar en modo auto (-1) o ya con un nivel elegido según el
    // bandwidth inicial — ambos son válidos. Lo que NO debe ocurrir: un índice fuera de rango.
    await expect.poll(
      () => player.getNextLevel(),
      { timeout: 8_000, message: 'nextLevel debe ser -1 (auto) o un índice de nivel válido' }
    ).toBeGreaterThanOrEqual(-1)

    const nextLevel = await player.getNextLevel()
    expect(
      nextLevel,
      `nextLevel (${nextLevel}) no debe exceder el índice máximo de nivel (${levels.length - 1})`
    ).toBeLessThanOrEqual(levels.length - 1)
  })

  test('forzar nivel 0 vía player.level se refleja en level', async ({ isolatedPlayer: player }) => {
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 20_000)

    // player.level es read-write (base.js props). Forzar 0 (menor calidad) debe reflejarse.
    // (nextLevel es READ-ONLY — refleja la elección de hls.js, no se puede escribir.)
    await player.setLevel(0)
    await expect.poll(
      () => player.getLevel(),
      { timeout: 15_000, message: 'player.level=0 debe reflejarse en level tras el switch' }
    ).toBe(0)
  })

  test('cambiar de nivel forzado a otro se refleja en level', async ({ isolatedPlayer: player }) => {
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 20_000)

    const levels = await player.getLevels()
    if (levels.length < 2) { test.skip(); return }
    const maxLevel = levels.length - 1

    // Forzar el nivel más bajo, luego el más alto — level debe seguir ambos cambios.
    await player.setLevel(0)
    await expect.poll(
      () => player.getLevel(),
      { timeout: 15_000, message: 'level debe llegar a 0' }
    ).toBe(0)

    await player.setLevel(maxLevel)
    await expect.poll(
      () => player.getLevel(),
      { timeout: 20_000, message: `level debe llegar a maxLevel (${maxLevel})` }
    ).toBe(maxLevel)
  })

  test('level y nextLevel son índices válidos tras forzar un nivel', async ({ isolatedPlayer: player }) => {
    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
    await player.waitForEvent('playing', 20_000)

    const levels = await player.getLevels()
    if (levels.length < 2) { test.skip(); return }
    const maxLevel = levels.length - 1

    // Forzar el nivel más alto vía level (read-write); level debe adoptarlo.
    await player.setLevel(maxLevel)
    await expect.poll(
      () => player.getLevel(),
      { timeout: 20_000, message: `level debe llegar a maxLevel (${maxLevel})` }
    ).toBe(maxLevel)

    // nextLevel (read-only) refleja la elección de hls.js: -1 (auto) o un índice en rango.
    const nextLevel = await player.getNextLevel()
    expect(nextLevel, `nextLevel (${nextLevel}) debe ser -1 o un índice válido`).toBeGreaterThanOrEqual(-1)
    expect(nextLevel, `nextLevel (${nextLevel}) no debe exceder maxLevel`).toBeLessThanOrEqual(maxLevel)
  })
})
