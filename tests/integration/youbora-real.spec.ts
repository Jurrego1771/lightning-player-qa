/**
 * youbora-real.spec.ts - Tests de Youbora con URL real (sin mocks)
 *
 * Propósito: Descartar problemas de mockeado y aislar el comportamiento real
 * de Youbora con una URL que ya tiene configuración completa.
 *
 * URL de prueba: https://develop.mdstrm.com/embed/69d2f1e0461dd502cd921ad6
 * - Contenido real con Youbora configurado
 * - Sin mocks de plataforma
 * - Sin streams locales
 *
 * Estrategia: Misma lógica de interceptación que youbora.spec.ts pero
 * con player real en lugar de isolatedPlayer.
 */
import { test, expect } from '@playwright/test'
import type { Route } from '@playwright/test'

// Constantes
const REAL_PLAYER_URL = 'https://develop.mdstrm.com/embed/69d2f1e0461dd502cd921ad6?player=69f11623472377eda39c266e'

// Helper: capturar beacons NPAW (misma implementación que youbora.spec.ts)
async function setupNpawInterceptor(page: import('@playwright/test').Page): Promise<string[]> {
  const beacons: string[] = []

  const captureBeacon = async (route: Route) => {
    beacons.push(route.request().url())
    await route.fulfill({ status: 200, body: '' })
  }

  // Capturar solo NQS (beacons de sesión reales) - dejar LMA sin interceptar
  await page.route(/youboranqs01\.com\//, captureBeacon)
  await page.route(/\.youbora\.com\//, captureBeacon)

  return beacons
}

// Helper: esperar a que el player esté listo
async function waitForPlayerReady(page: import('@playwright/test').Page, timeout = 30_000): Promise<void> {
  await page.waitForFunction(
    () => {
      const player =
        (window as any).lightningPlayer ||
        (window as any).MSPlayer ||
        (window as any).player
      return player && typeof player.play === 'function' && typeof player.pause === 'function'
    },
    { timeout }
  )
}

async function playRealPlayer(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    const player =
      (window as any).lightningPlayer ||
      (window as any).MSPlayer ||
      (window as any).player
    if (player && typeof player.play === 'function') {
      player.play()
    }
  })
}

async function pauseRealPlayer(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    const player =
      (window as any).lightningPlayer ||
      (window as any).MSPlayer ||
      (window as any).player
    if (player && typeof player.pause === 'function') {
      player.pause()
    }
  })
}

async function getRealPlayerState(page: import('@playwright/test').Page): Promise<{ paused: unknown; currentTime: unknown; duration?: unknown; ended?: unknown; ready: boolean }> {
  return page.evaluate(() => {
    const player =
      (window as any).lightningPlayer ||
      (window as any).MSPlayer ||
      (window as any).player
    return {
      paused: player?.paused,
      currentTime: player?.currentTime,
      duration: player?.duration,
      ended: player?.ended,
      ready: !!player,
    }
  })
}

async function seekRealPlayer(page: import('@playwright/test').Page, targetTime: number): Promise<void> {
  await page.evaluate((nextTime) => {
    const player =
      (window as any).lightningPlayer ||
      (window as any).MSPlayer ||
      (window as any).player
    if (player) {
      player.currentTime = nextTime
    }
  }, targetTime)
}

// Tests con URL real
test.describe('Youbora - Real URL Tests', { tag: ['@integration', '@analytics', '@youbora', '@real'] }, () => {

  test('emits start beacon after contentFirstPlay - REAL URL', async ({ page }) => {
    // Arrange
    const beacons = await setupNpawInterceptor(page)

    // Logging de descubrimiento de dominios
    page.on('request', (req) => {
      const url = req.url()
      if (url.includes('npaw') || url.includes('youbora')) {
        console.log('[NPAW beacon discovered]', url)
      }
    })

    // Act - navegar a la URL real
    await page.goto(REAL_PLAYER_URL)

    // Esperar a que el player esté listo
    await waitForPlayerReady(page)

    // Debug: estado inicial
    console.log('[DEBUG] Beacons iniciales:', beacons.length)

    // Iniciar reproducción (si no es autoplay)
    await playRealPlayer(page)

    // Debug: después de iniciar
    console.log('[DEBUG] Beacons después de iniciar:', beacons.length)
    console.log('[DEBUG] Beacons capturados:', beacons.map(url => url.split('/').pop()))

    // Assert - verificar beacons de start
    const startBeacons = () =>
      beacons.filter(url =>
        url.includes('/start') || url.includes('/joinTime')
      ).length

    await expect.poll(startBeacons, {
      timeout: 8_000,
      message: 'Se esperaban beacons /start y/o /joinTime tras iniciar reproducción',
    }).toBeGreaterThan(0)
  })

  test('emits pause beacon after player.pause() - REAL URL', async ({ page }) => {
    // Arrange
    const beacons = await setupNpawInterceptor(page)

    // Logging de descubrimiento de dominios
    page.on('request', (req) => {
      const url = req.url()
      if (url.includes('npaw') || url.includes('youbora')) {
        console.log('[NPAW beacon discovered]', url)
      }
    })

    // Act - navegar a la URL real
    await page.goto(REAL_PLAYER_URL)

    // Esperar a que el player esté listo
    await waitForPlayerReady(page)

    // Iniciar reproducción
    await playRealPlayer(page)

    const startBeacons = () =>
      beacons.filter(url =>
        url.includes('/start') || url.includes('/joinTime')
      ).length

    await expect.poll(startBeacons, {
      timeout: 20_000,
      message: 'Se esperaban beacons /start y/o /joinTime antes de pausar el player',
    }).toBeGreaterThan(0)

    // Debug: estado antes de pausar
    console.log('[DEBUG] Beacons antes de pause:', beacons.length)
    const playerStateBefore = await getRealPlayerState(page)
    console.log('[DEBUG] Estado player antes de pause:', playerStateBefore)

    // Pausar el player
    await pauseRealPlayer(page)

    // Debug: estado después de pausar
    console.log('[DEBUG] Beacons después de pause:', beacons.length)
    const playerStateAfter = await getRealPlayerState(page)
    console.log('[DEBUG] Estado player después de pause:', playerStateAfter)
    console.log('[DEBUG] Beacons capturados:', beacons.map(url => url.split('/').pop()))

    // Assert - verificar beacon de pause
    const pauseBeacons = () =>
      beacons.filter(url => url.includes('/pause')).length

    await expect.poll(pauseBeacons, {
      timeout: 8_000,
      message: 'Se esperaba beacon /pause tras pausar el player',
    }).toBeGreaterThan(0)
  })

  test('emits resume beacon after pause/play cycle - REAL URL', async ({ page }) => {
    const beacons = await setupNpawInterceptor(page)

    await page.goto(REAL_PLAYER_URL)
    await waitForPlayerReady(page)
    await playRealPlayer(page)

    const startBeacons = () =>
      beacons.filter(url => url.includes('/start') || url.includes('/joinTime')).length

    await expect.poll(startBeacons, {
      timeout: 20_000,
      message: 'Se esperaban beacons de sesión antes de probar resume',
    }).toBeGreaterThan(0)

    await pauseRealPlayer(page)

    const pauseBeacons = () =>
      beacons.filter(url => url.includes('/pause')).length

    await expect.poll(pauseBeacons, {
      timeout: 8_000,
      message: 'Se esperaba beacon /pause antes de probar resume',
    }).toBeGreaterThan(0)

    const n0 = beacons.filter(url => url.includes('/resume')).length

    await playRealPlayer(page)

    await expect.poll(
      () => beacons.filter(url => url.includes('/resume')).length,
      {
        timeout: 8_000,
        message: 'Se esperaba beacon /resume tras reanudar la reproducción',
      }
    ).toBeGreaterThan(n0)
  })

  test('emits seek beacon after currentTime jump - REAL URL', async ({ page }) => {
    const beacons = await setupNpawInterceptor(page)

    await page.goto(REAL_PLAYER_URL)
    await waitForPlayerReady(page)
    await playRealPlayer(page)

    const startBeacons = () =>
      beacons.filter(url => url.includes('/start') || url.includes('/joinTime')).length

    await expect.poll(startBeacons, {
      timeout: 20_000,
      message: 'Se esperaban beacons de sesión antes de probar seek',
    }).toBeGreaterThan(0)

    await expect.poll(
      async () => {
        const state = await getRealPlayerState(page)
        return Number(state.currentTime ?? 0)
      },
      {
        timeout: 15_000,
        message: 'currentTime debe avanzar antes de probar seek',
      }
    ).toBeGreaterThan(5)

    const currentTime = Number((await getRealPlayerState(page)).currentTime ?? 0)
    const n0 = beacons.filter(url => url.includes('/seek')).length

    await seekRealPlayer(page, currentTime + 10)

    await expect.poll(
      () => beacons.filter(url => url.includes('/seek')).length,
      {
        timeout: 8_000,
        message: 'Se esperaba beacon /seek tras mover currentTime',
      }
    ).toBeGreaterThan(n0)
  })

  test('emits stop beacon after video ended - REAL URL', async ({ page }) => {
    const beacons = await setupNpawInterceptor(page)

    await page.goto(REAL_PLAYER_URL)
    await waitForPlayerReady(page)
    await playRealPlayer(page)

    const startBeacons = () =>
      beacons.filter(url => url.includes('/start') || url.includes('/joinTime')).length

    await expect.poll(startBeacons, {
      timeout: 20_000,
      message: 'Se esperaban beacons de sesión antes de probar ended',
    }).toBeGreaterThan(0)

    await expect.poll(
      async () => {
        const state = await getRealPlayerState(page)
        return Number(state.duration ?? 0)
      },
      {
        timeout: 15_000,
        message: 'duration debe estar disponible antes de buscar el final del video',
      }
    ).toBeGreaterThan(1)

    const duration = Number((await getRealPlayerState(page)).duration ?? 0)
    const n0 = beacons.filter(url => url.includes('/stop')).length

    await seekRealPlayer(page, Math.max(1, duration - 0.5))

    await expect.poll(
      async () => {
        const state = await getRealPlayerState(page)
        return state.ended === true
      },
      {
        timeout: 12_000,
        message: 'El video real debía llegar a ended tras seek al final',
      }
    ).toBe(true)

    await expect.poll(
      () => beacons.filter(url => url.includes('/stop')).length,
      {
        timeout: 8_000,
        message: 'Se esperaba beacon /stop tras terminar el video',
      }
    ).toBeGreaterThan(n0)
  })

  test('replay after ended opens a new Youbora session - REAL URL', async ({ page }) => {
    const beacons = await setupNpawInterceptor(page)

    await page.goto(REAL_PLAYER_URL)
    await waitForPlayerReady(page)
    await playRealPlayer(page)

    await expect.poll(
      () => beacons.filter(url => url.includes('/start') || url.includes('/joinTime')).length,
      {
        timeout: 20_000,
        message: 'Se esperaba la primera sesión Youbora antes de probar replay',
      }
    ).toBeGreaterThan(0)

    await expect.poll(
      async () => {
        const state = await getRealPlayerState(page)
        return Number(state.duration ?? 0)
      },
      {
        timeout: 15_000,
        message: 'duration debe estar disponible antes de replay',
      }
    ).toBeGreaterThan(1)

    const duration = Number((await getRealPlayerState(page)).duration ?? 0)
    const sessionStartsBeforeReplay =
      beacons.filter(url => url.includes('/start') || url.includes('/joinTime')).length

    await seekRealPlayer(page, Math.max(1, duration - 0.5))

    await expect.poll(
      async () => {
        const state = await getRealPlayerState(page)
        return state.ended === true
      },
      {
        timeout: 12_000,
        message: 'El video debía terminar antes de probar replay',
      }
    ).toBe(true)

    await playRealPlayer(page)

    await expect.poll(
      () => beacons.filter(url => url.includes('/start') || url.includes('/joinTime')).length,
      {
        timeout: 15_000,
        message: 'Se esperaba nueva sesión Youbora tras replay',
      }
    ).toBeGreaterThan(sessionStartsBeforeReplay)
  })

})
