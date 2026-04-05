/**
 * network-conditions.ts — Utilidades para simular condiciones de red
 *
 * Wrapper sobre el NetworkProfiles de streams.ts + CDP para
 * facilitar el uso en tests de integración y performance.
 */
import { Page } from '@playwright/test'
import { NetworkProfiles } from '../fixtures/streams'
import { createCDPSession, setNetworkThrottle, removeNetworkThrottle } from './qoe-metrics'

export type NetworkProfile = keyof typeof NetworkProfiles

/**
 * Ejecuta un bloque con throttling de red, luego lo restaura.
 *
 * @example
 * await withNetworkCondition(page, 'degraded3G', async () => {
 *   await player.play()
 *   await player.waitForEvent('levelchanged')
 *   expect(await player.getCurrentBitrate()).toBeLessThan(500_000)
 * })
 */
export async function withNetworkCondition(
  page: Page,
  profile: NetworkProfile,
  fn: () => Promise<void>
): Promise<void> {
  const cdp = await createCDPSession(page)
  try {
    await setNetworkThrottle(cdp, NetworkProfiles[profile])
    await fn()
  } finally {
    await removeNetworkThrottle(cdp)
    await cdp.detach()
  }
}

/**
 * Intercepta y bloquea requests a un host específico (simula CDN offline)
 */
export async function blockHost(page: Page, hostPattern: string): Promise<() => Promise<void>> {
  await page.route(`**/${hostPattern}/**`, (route) => route.abort('failed'))

  return async () => {
    await page.unroute(`**/${hostPattern}/**`)
  }
}

/**
 * Inyecta un delay artificial en todas las requests (simula latencia alta)
 */
export async function addLatency(page: Page, delayMs: number): Promise<() => Promise<void>> {
  await page.route('**/*', async (route) => {
    await new Promise((r) => setTimeout(r, delayMs))
    await route.continue()
  })

  return async () => { await page.unrouteAll() }
}
