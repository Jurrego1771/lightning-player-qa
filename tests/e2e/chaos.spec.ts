/**
 * chaos.spec.ts — Chaos Engineering para streaming
 *
 * Valida que el player sobrevive condiciones adversas de producción:
 *   - CDN timeout mid-stream (silent drop)
 *   - Manifest intermitente (CDN inestable)
 *   - Alta latencia (red saturada)
 *
 * No usa fixture `player` (real platform) — usa `isolatedPlayer` para control total.
 * Los escenarios son probabilísticos excepto timeout (determinista).
 *
 * Tag: @e2e @chaos
 */
import { test, expect, MockContentIds } from '../../fixtures'
import { chaosSegmentTimeout, chaosManifestFlaky, chaosHighLatency } from '../../helpers/chaos'

test.describe('Chaos — CDN Timeout Mid-Stream', { tag: ['@e2e', '@chaos'] }, () => {

  test('segment timeout: player emite error sin crash JS', async ({ isolatedPlayer: player, page }) => {
    // Dejar pasar 1 segmento (player inicia), luego timeout en todos los siguientes.
    // hls.js tiene ~10s timeout → player debe emitir error dentro de 30s.
    test.setTimeout(90_000)

    const uncaughtErrors: string[] = []
    page.on('pageerror', (err) => {
      const msg = err.message.toLowerCase()
      if (!msg.includes('notallowederror') && !msg.includes('hls') && !msg.includes('aborted')) {
        uncaughtErrors.push(err.message)
      }
    })

    const chaos = await chaosSegmentTimeout(page, { afterCount: 1, timeoutMs: 12_000 })

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })

    // Player debe emitir error (no quedar en buffering indefinido)
    await player.waitForEvent('error', 60_000)

    const errors = await player.getErrors()
    const errorData: unknown = await page.evaluate(() => (window as any).__qa?.eventData?.error ?? null)
    const playerStatus = await player.getStatus()

    const hasError = errors.length > 0 || errorData != null || (playerStatus as string) === 'error'
    expect(hasError, `Player debe reportar error tras timeout de segmento. status=${playerStatus}`).toBe(true)
    expect(uncaughtErrors, `Sin crashes JS. Errores: ${uncaughtErrors.join(' | ')}`).toHaveLength(0)

    await chaos.stop()
  })

})

test.describe('Chaos — Manifest Intermitente', { tag: ['@e2e', '@chaos'] }, () => {

  test('manifests con 40% fallo: player inicia o emite error sin crash', async ({ isolatedPlayer: player, page }) => {
    // Con 40% de manifests fallando, el player puede:
    //   a) Iniciar si el primer intento tiene éxito (retry en hls.js)
    //   b) Emitir error si agota retries
    // Ambos resultados son válidos — el contrato es que NO crashee.
    test.setTimeout(60_000)

    const uncaughtErrors: string[] = []
    page.on('pageerror', (err) => {
      const msg = err.message.toLowerCase()
      if (!msg.includes('notallowederror') && !msg.includes('hls')) {
        uncaughtErrors.push(err.message)
      }
    })

    const chaos = await chaosManifestFlaky(page, { failRate: 0.4, status: 503 })

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })

    // Esperar: playing O error (ambos son resultados válidos bajo caos)
    await Promise.race([
      player.waitForEvent('playing', 30_000),
      player.waitForEvent('error', 30_000),
    ])

    const playerStatus = await player.getStatus()
    const validStates = ['playing', 'pause', 'error', 'idle', 'buffering']
    expect(
      validStates.includes(playerStatus as string) || (playerStatus as string) === 'error',
      `Player en estado válido. status=${playerStatus}`
    ).toBe(true)

    expect(uncaughtErrors, `Sin crashes JS. Errores: ${uncaughtErrors.join(' | ')}`).toHaveLength(0)

    await chaos.stop()
  })

})

test.describe('Chaos — Alta Latencia', { tag: ['@e2e', '@chaos'] }, () => {

  test('latencia de 3s por segmento: player bufferiza sin error fatal', async ({ isolatedPlayer: player, page }) => {
    // Con 3s por segmento, el player debe buffering (no error).
    // hls.js timeout por defecto es ~10s → 3s debería ser tolerable.
    // El player no debe emitir 'error', puede estar en 'buffering' indefinidamente.
    test.setTimeout(60_000)

    const errors: string[] = []
    page.on('pageerror', (err) => {
      if (!err.message.toLowerCase().includes('hls')) errors.push(err.message)
    })

    const chaos = await chaosHighLatency(page, { latencyMs: 3_000 })

    await player.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })

    // Esperar suficiente tiempo para que el primer segmento (3s delay) descargue
    await page.waitForTimeout(10_000)

    const playerStatus = await player.getStatus()
    // No debe estar en estado 'error' — debe estar en playing o buffering
    expect(
      (playerStatus as string) === 'error',
      `Player no debe emitir error fatal con solo 3s de latencia. status=${playerStatus}`
    ).toBe(false)

    expect(errors, `Sin crashes JS bajo latencia alta. Errores: ${errors.join(' | ')}`).toHaveLength(0)

    await chaos.stop()
  })

})
