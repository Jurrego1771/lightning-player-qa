/**
 * chaos.ts — Chaos engineering scenarios para streaming QA
 *
 * Simula condiciones adversas de producción que no se pueden reproducir
 * con route.abort (TCP-level) ni con errores HTTP simples:
 *   - CDN timeout mid-stream (segmentos que nunca responden)
 *   - Manifest intermitente (CDN inestable con tasa de fallo configurable)
 *   - Token expirado mid-session (plataforma revoca acceso)
 *   - Latencia extrema en manifest refresh (live stream lag)
 *
 * Diferencia vs stream-injector.ts:
 *   stream-injector → errores HTTP controlados (503/404), deterministas
 *   chaos.ts        → escenarios probabilísticos o con timing real
 */
import { Page } from '@playwright/test'

export interface ChaosCleanup {
  stop: () => Promise<void>
}

/**
 * Simula CDN timeout: segmentos nunca responden (after N exitosos).
 * hls.js agotará su socket timeout y emitirá error.
 *
 * Diferente a abort('failed'): abort es TCP reset inmediato; este es silent drop.
 * hls.js tiene timeout de ~10s por request antes de emitir error.
 */
export async function chaosSegmentTimeout(
  page: Page,
  options: { afterCount?: number; timeoutMs?: number } = {}
): Promise<ChaosCleanup> {
  const { afterCount = 1, timeoutMs = 15_000 } = options
  let count = 0

  await page.route('**/segment*.ts', async (route) => {
    count++
    if (count > afterCount) {
      // Nunca responder — simular silent drop / timeout
      await new Promise((r) => setTimeout(r, timeoutMs))
      await route.abort('timedout')
    } else {
      await route.continue()
    }
  })

  return { stop: async () => page.unroute('**/segment*.ts') }
}

/**
 * Simula manifest intermitente: failRate% de las requests de playlist fallan con 503.
 * Modela CDN inestable donde el player debe reintentar y recuperar.
 *
 * En streams live el manifest se refresca cada ~targetDuration segundos.
 * Con failRate=0.3, 30% de los refreshes fallan → el player debe sobrevivir.
 */
export async function chaosManifestFlaky(
  page: Page,
  options: { failRate?: number; status?: number } = {}
): Promise<ChaosCleanup> {
  const { failRate = 0.4, status = 503 } = options

  await page.route('**/*.m3u8', async (route) => {
    if (Math.random() < failRate) {
      await route.fulfill({ status, body: '' })
    } else {
      await route.continue()
    }
  })

  return { stop: async () => page.unroute('**/*.m3u8') }
}

/**
 * Simula token expirado mid-session: intercepta llamadas de plataforma y devuelve 401.
 * El player debe emitir error y no crashear.
 *
 * Aplica a requests al dominio de plataforma (no a CDN de media).
 */
export async function chaosPlatformUnauthorized(
  page: Page,
  options: { afterInitMs?: number } = {}
): Promise<ChaosCleanup> {
  const { afterInitMs = 2000 } = options

  // Esperar que el player inicie antes de activar el caos
  await new Promise((r) => setTimeout(r, afterInitMs))

  const pattern = '**/api/**'
  await page.route(pattern, async (route) => {
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'token_expired', fatal: true }),
    })
  })

  return { stop: async () => page.unroute(pattern) }
}

/**
 * Simula latencia extrema en todos los segmentos (red satelital / 2G).
 * El player debe bufferear pero no emitir error si no hay timeout.
 *
 * Útil para validar que el UX de "buffering" es tolerante y no hay false errors.
 */
export async function chaosHighLatency(
  page: Page,
  options: { latencyMs?: number } = {}
): Promise<ChaosCleanup> {
  const { latencyMs = 3000 } = options

  await page.route('**/segment*.ts', async (route) => {
    await new Promise((r) => setTimeout(r, latencyMs))
    await route.continue()
  })

  return { stop: async () => page.unroute('**/segment*.ts') }
}
