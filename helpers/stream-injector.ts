/**
 * stream-injector.ts — Inyección controlada de errores de stream
 *
 * Permite simular fallos de CDN mid-stream de forma determinista:
 *   - 503/504 después de N segmentos exitosos (CDN momentáneamente caído)
 *   - Timeout de segmentos (CDN congestionado)
 *   - Error en manifest refresh (playlist expirada)
 *
 * Complementa error-recovery.spec.ts (que usa route.abort — fallo TCP-level).
 * Este helper simula fallos HTTP-level con status codes, que hls.js maneja
 * con lógica de retry diferente a los abortos de red.
 */
import { Page } from '@playwright/test'

export interface SegmentInjectorOptions {
  /** Cuántos segmentos exitosos antes de empezar a fallar. Default: 0 (fallar inmediato) */
  afterCount?: number
  /** HTTP status a devolver. Default: 503 */
  status?: number
  /** Body de la respuesta. Default: '' */
  body?: string
  // URL pattern to intercept. Default: '** /segment*.ts' (glob)
  pattern?: string
  /** Si true, solo falla `count` segmentos y luego continúa (transitorio). Default: false */
  transient?: boolean
  /** Cuántos segmentos fallar antes de volver a normal (requiere transient: true). Default: 3 */
  failCount?: number
}

/**
 * Intercepta segmentos HLS con un error HTTP (503, 404, etc.) de forma controlada.
 * Retorna una función que desregistra el handler (cleanup).
 *
 * @example
 * // Fallar todos los segmentos con 503 desde el inicio
 * const stop = await injectSegmentError(page, { status: 503 })
 * await player.goto(...)
 * await player.waitForEvent('error', 60_000)
 * await stop()
 *
 * @example
 * // Fallar 3 segmentos mid-stream (transitorio), luego recuperar
 * const stop = await injectSegmentError(page, { afterCount: 2, transient: true, failCount: 3 })
 * await player.goto({ ..., autoplay: true })
 * await player.waitForEvent('playing', 20_000)
 * await stop()
 */
export async function injectSegmentError(
  page: Page,
  options: SegmentInjectorOptions = {}
): Promise<() => Promise<void>> {
  const {
    afterCount = 0,
    status = 503,
    body = '',
    pattern = '**/segment*.ts',
    transient = false,
    failCount = 3,
  } = options

  let successCount = 0
  let failedCount = 0

  await page.route(pattern, async (route) => {
    const shouldFail = successCount >= afterCount && (!transient || failedCount < failCount)

    if (shouldFail) {
      failedCount++
      await route.fulfill({ status, body, headers: { 'content-type': 'video/mp2t' } })
    } else {
      if (successCount < afterCount) successCount++
      await route.continue()
    }
  })

  return async () => {
    await page.unroute(pattern)
  }
}

/**
 * Inyecta latencia artificial en requests de segmentos (simula CDN congestionado).
 * Retorna función de cleanup.
 *
 * @example
 * const stop = await injectSegmentLatency(page, { delayMs: 5000, afterCount: 1 })
 * await player.goto(...)
 * await stop()
 */
export async function injectSegmentLatency(
  page: Page,
  options: { delayMs: number; afterCount?: number; pattern?: string } = { delayMs: 5000 }
): Promise<() => Promise<void>> {
  const { delayMs, afterCount = 0, pattern = '**/segment*.ts' } = options
  let count = 0

  await page.route(pattern, async (route) => {
    count++
    if (count > afterCount) {
      await new Promise((r) => setTimeout(r, delayMs))
    }
    await route.continue()
  })

  return async () => {
    await page.unroute(pattern)
  }
}

/**
 * Inyecta error en el manifest HLS (simula playlist expirada o CDN caído).
 * Útil para testear recovery de manifest refresh en streams live.
 */
export async function injectManifestError(
  page: Page,
  options: { status?: number; afterCount?: number; pattern?: string } = {}
): Promise<() => Promise<void>> {
  const { status = 503, afterCount = 0, pattern = '**/*.m3u8' } = options
  let count = 0

  await page.route(pattern, async (route) => {
    count++
    if (count > afterCount) {
      await route.fulfill({ status, body: '' })
    } else {
      await route.continue()
    }
  })

  return async () => {
    await page.unroute(pattern)
  }
}
