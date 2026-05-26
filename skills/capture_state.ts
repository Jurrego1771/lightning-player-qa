#!/usr/bin/env ts-node
/**
 * capture_state.ts — Captura un screenshot del player en un estado específico
 *
 * Uso:
 *   ts-node skills/capture_state.ts --state idle --output screenshots/idle.png
 *   ts-node skills/capture_state.ts --state playing --output screenshots/playing.png --player-url http://localhost:3000/
 *
 * Estados disponibles: idle | buffering | playing | controls | fullscreen | error | ad_break
 */

import * as path from 'path'
import * as fs from 'fs'
import * as dotenv from 'dotenv'

dotenv.config({ path: path.resolve(__dirname, '../.env') })

import { chromium, Browser, Page } from '@playwright/test'

const REPO_ROOT = path.resolve(__dirname, '..')

type PlayerState = 'idle' | 'buffering' | 'playing' | 'controls' | 'fullscreen' | 'error' | 'ad_break'

const VALID_STATES: PlayerState[] = ['idle', 'buffering', 'playing', 'controls', 'fullscreen', 'error', 'ad_break']

interface CaptureResult {
  state: PlayerState
  output_path: string
  captured_at: string
  width: number
  height: number
}

function die(msg: string): never {
  process.stderr.write(`ERROR: ${msg}\n`)
  process.exit(1)
}

function parseArgs(argv: string[]): {
  state: PlayerState
  outputPath: string
  playerUrl: string
} {
  const get = (flag: string) => {
    const idx = argv.indexOf(flag)
    return idx !== -1 ? argv[idx + 1] : undefined
  }

  const stateArg = get('--state') ?? 'idle'
  if (!VALID_STATES.includes(stateArg as PlayerState)) {
    die(`Estado inválido: "${stateArg}". Válidos: ${VALID_STATES.join(', ')}`)
  }

  const outputArg = get('--output')
  if (!outputArg) die('--output es requerido. Ej: --output screenshots/idle.png')

  // URL por defecto: desde .env o localhost
  const defaultUrl = process.env.PLAYER_DEV_URL ?? process.env.PLAYER_URL ?? 'http://localhost:3000/'
  const playerUrl  = get('--player-url') ?? defaultUrl

  return {
    state:      stateArg as PlayerState,
    outputPath: outputArg,
    playerUrl,
  }
}

function resolvePath(p: string): string {
  return path.isAbsolute(p) ? p : path.join(REPO_ROOT, p)
}

/**
 * Intenta esperar un evento del player via window.LightningPlayer o
 * escuchando eventos del DOM. Timeout suave — no falla el capture si no ocurre.
 */
async function waitForPlayerEvent(page: Page, eventName: string, timeoutMs = 5000): Promise<boolean> {
  try {
    await page.waitForFunction(
      (evt: string) => {
        return new Promise<boolean>(resolve => {
          const player = (window as Window & { LightningPlayer?: { on?: (e: string, cb: () => void) => void } }).LightningPlayer
          if (player?.on) {
            player.on(evt, () => resolve(true))
          } else {
            // Fallback: escuchar en el video element
            const video = document.querySelector('video')
            if (video) {
              video.addEventListener(evt, () => resolve(true), { once: true })
            } else {
              resolve(false)
            }
          }
          setTimeout(() => resolve(false), 4000)
        })
      },
      eventName,
      { timeout: timeoutMs }
    )
    return true
  } catch {
    return false
  }
}

/**
 * Secuencias de acciones por estado.
 * El player debe estar cargado en la URL antes de llamar a estas funciones.
 */
async function reachState(page: Page, state: PlayerState): Promise<void> {
  // Esperar que el player esté montado (busca el container o el video element)
  await page.waitForSelector('video, [data-player], #player, .mdstrm-player', {
    timeout: 15000,
  }).catch(() => {
    // Si no aparece, continuar de todas formas — la página puede no tener un player estándar
    process.stderr.write('WARN: No se encontró el elemento del player en la página\n')
  })

  switch (state) {
    case 'idle':
      // Solo cargar — no hacer nada más
      await page.waitForTimeout(500)
      break

    case 'buffering':
      // Llamar play() y capturar inmediatamente (estado transitorio)
      await page.evaluate(() => {
        const video = document.querySelector('video') as HTMLVideoElement | null
        if (video) video.play().catch(() => {})
      })
      await page.waitForTimeout(300)
      break

    case 'playing':
      // Llamar play() y esperar loadedmetadata o timeupdate
      await page.evaluate(() => {
        const video = document.querySelector('video') as HTMLVideoElement | null
        if (video) video.play().catch(() => {})
      })
      await page.waitForFunction(() => {
        const video = document.querySelector('video') as HTMLVideoElement | null
        return video ? (video.readyState >= 3 && !video.paused) : false
      }, { timeout: 10000 }).catch(() => {
        // Timeout suave — continuar con screenshot aunque no esté reproduciendo
      })
      break

    case 'controls':
      // Llegar a playing y luego hacer hover sobre el player para mostrar controles
      await reachState(page, 'playing')
      await page.waitForTimeout(200)
      {
        const playerEl = await page.$('video, [data-player], #player, .mdstrm-player')
        if (playerEl) {
          const box = await playerEl.boundingBox()
          if (box) {
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
          }
        }
      }
      await page.waitForTimeout(500) // dar tiempo a que aparezca el overlay de controles
      break

    case 'fullscreen':
      // Llegar a playing y luego pedir fullscreen via API
      await reachState(page, 'playing')
      await page.evaluate(() => {
        const playerEl = document.querySelector('[data-player], #player, .mdstrm-player, video') as HTMLElement | null
        if (playerEl?.requestFullscreen) playerEl.requestFullscreen().catch(() => {})
      })
      await page.waitForTimeout(800)
      break

    case 'error':
      // Navegar a una URL de stream inválida para provocar error
      await page.evaluate(() => {
        const video = document.querySelector('video') as HTMLVideoElement | null
        if (video) {
          video.src = 'https://invalid.example.com/stream.m3u8'
          video.load()
        }
      })
      await page.waitForFunction(() => {
        const video = document.querySelector('video') as HTMLVideoElement | null
        return video ? video.error !== null : false
      }, { timeout: 8000 }).catch(() => {})
      await page.waitForTimeout(500)
      break

    case 'ad_break':
      // Para ad_break: esperar un cuepoint o que isPlayingAd sea true
      await page.evaluate(() => {
        const video = document.querySelector('video') as HTMLVideoElement | null
        if (video) video.play().catch(() => {})
      })
      await page.waitForFunction(() => {
        const player = (window as Window & { LightningPlayer?: { isPlayingAd?: boolean } }).LightningPlayer
        return player?.isPlayingAd === true
      }, { timeout: 12000 }).catch(() => {
        process.stderr.write('WARN: No se detectó un ad_break activo\n')
      })
      break
  }
}

async function main() {
  const { state, outputPath, playerUrl } = parseArgs(process.argv.slice(2))

  const absoluteOutput = resolvePath(outputPath)
  fs.mkdirSync(path.dirname(absoluteOutput), { recursive: true })

  let browser: Browser | null = null

  try {
    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    })
    const page = await context.newPage()

    // Silenciar errores de consola que no afectan el capture
    page.on('console', msg => {
      if (msg.type() === 'error') {
        process.stderr.write(`PAGE ERROR: ${msg.text()}\n`)
      }
    })

    await page.goto(playerUrl, { waitUntil: 'domcontentloaded', timeout: 15000 })

    await reachState(page, state)

    const viewport = page.viewportSize() ?? { width: 1280, height: 720 }
    await page.screenshot({ path: absoluteOutput, fullPage: false })

    const relOutputPath = path.relative(REPO_ROOT, absoluteOutput).replace(/\\/g, '/')

    const result: CaptureResult = {
      state,
      output_path: relOutputPath,
      captured_at: new Date().toISOString(),
      width:  viewport.width,
      height: viewport.height,
    }

    console.log(JSON.stringify(result, null, 2))
  } finally {
    await browser?.close()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
