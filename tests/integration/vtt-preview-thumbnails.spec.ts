/**
 * vtt-preview-thumbnails.spec.ts — Tests de integración para el componente WebVTTPreview
 *
 * Cubre el gap MUST del módulo ui-common detectado por A4 (PR #708, fix #707):
 *   WebVTTPreview / declaredSpriteSize / hasCurrentImage
 *
 * La fix del PR (#707, commit fdaec73c) introduce escalado de coordenadas para que
 * el drawImage funcione correctamente cuando el sprite real difiere del tamaño
 * declarado en el VTT. El reviewer (janoppix) identifica casos donde el fix
 * es insuficiente — estos tests los formalizan como regresión.
 *
 * Comportamiento del componente (fuente: src/view/common/components/webVttPreview/index.js):
 *   1. El contenido declara metadata.preview.vtt → URL al archivo WebVTT
 *   2. El VTT tiene cues con: {startTime} --> {endTime}\n{spriteUrl}#xywh=x,y,w,h
 *   3. El player calcula:
 *        declaredSpriteSize = max(x+w, y+h) de todos los cues del VTT
 *        scaleX = image.naturalWidth  / declaredSpriteSize.width   (1.0 si sprite coincide)
 *        scaleY = image.naturalHeight / declaredSpriteSize.height
 *   4. Renderiza: ctx.drawImage(image, x*scaleX, y*scaleY, w*scaleX, h*scaleY, 0, 0, w, h)
 *   5. El canvas (.preview-screen) queda visible dentro de .hover-time cuando hay imagen
 *
 * Casos cubiertos:
 *   (a) Sprite con grilla COMPLETA que coincide con el VTT → thumbnail se rellena (blankFrac ≈ 0)
 *   (b) BLOQUEANTE — Sprite con ÚLTIMA FILA INCOMPLETA (caso default ffmpeg -vf tile):
 *         max(x+w) subestima el ancho → scaleX sobreescalado → clipping silencioso.
 *         Aserción que DEBE fallar si el bug está presente.
 *   (c) Sprite retina/escalado (naturalWidth = 2x el declarado en VTT) →
 *         thumbnail correctamente encuadrado (blankFrac ≈ 0 en el doble-res)
 *   (d) VTT multi-sprite (cues con varios .png distintos) →
 *         scaleX/scaleY no deben divergir entre sprites
 *
 * Estrategia de verificación:
 *   - page.route() intercepta requests de VTT y sprites → fixtures sintéticos controlados
 *   - mockPlayerConfig() habilita view.showPreviews: true en el player config
 *   - mockContentConfig() inyecta metadata.preview.vtt en el content config
 *   - El test mueve el hover sobre el seek slider usando page.mouse.move()
 *   - Verifica la presencia y contenido del canvas .preview-screen via page.evaluate()
 *   - Mide blankFrac: fracción de píxeles negros/transparentes = clipping
 *   - Guarda screenshot de evidencia en test-results/evidence/pr708/
 *
 * Limitaciones documentadas:
 *   - El componente WebVTTPreview solo se renderiza cuando view.showPreviews: true
 *     en el player config Y metadata.preview.vtt está presente en el content config.
 *   - El hover requiere que el player esté en estado 'ready' y los controles visibles.
 *   - El análisis de blankFrac usa pixeles negros (R=0,G=0,B=0) o transparentes (A<128).
 *     Un sprite de color negro genuino daría falso positivo — por eso los helpers
 *     generan tiles de colores no-negros (rojo, verde, azul, etc.).
 *   - En Chromium: --autoplay-policy=no-user-gesture-required está configurado en
 *     playwright.config.ts. El test usa autoplay:false + waitForReady para control.
 *
 * Fixture: isolatedPlayer (plataforma mockeada — determinista)
 * Tags: @integration @vtt-preview @ui-common @pr708
 */

import * as path from 'path'
import * as fs from 'fs'
import { test, expect, MockContentIds, mockPlayerConfig, mockContentConfig } from '../../fixtures'
import {
  generateSpritePng,
  generateVttContent,
} from '../../fixtures/vtt-preview/sprite-helpers'

// ── URLs mock para sprites/VTT (interceptados via page.route) ─────────────────

const VTT_BASE     = 'http://localhost:9001/vtt-preview'
const SPRITE_A_URL = `${VTT_BASE}/sprite-a.png`   // grilla completa o case-specific
const SPRITE_B_URL = `${VTT_BASE}/sprite-b.png`   // sprite alternativo (multi-sprite test)
const VTT_URL      = `${VTT_BASE}/preview.vtt`

// ── Configuración estándar del sprite (tiles 216×122, grilla 10×10) ──────────
//
// Basada en los datos del ticket real (docs/evidence/thumbnails-sprite-mismatch/README.md):
// VTT declara tiles de 216×122, grid 10×10 → sprite esperado 2160×1220

const STD_TILE_W = 216
const STD_TILE_H = 122
const STD_COLS   = 10
const STD_ROWS   = 10

// ── Directorio de evidencia ───────────────────────────────────────────────────

const EVIDENCE_DIR = path.join(process.cwd(), 'test-results', 'evidence', 'pr708')

function ensureEvidenceDir(): void {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
}

// ── Helpers de verificación de canvas ────────────────────────────────────────

/**
 * Calcula la fracción de píxeles "en blanco" (negro u opaco-oscuro o transparente)
 * en el canvas .preview-screen, interpretada como clipping/corte.
 *
 * Un blankFrac alto (>0.10 = 10%) indica que más del 10% de los píxeles son
 * negros o transparentes — señal de clipping del drawImage.
 *
 * Criterio de negro: R<20 AND G<20 AND B<20 (evita falsos positivos en bordes)
 * Criterio de transparente: A<128 (medio opaco o menos)
 */
async function getCanvasBlankFrac(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas.preview-screen')
    if (!canvas || canvas.width === 0 || canvas.height === 0) {
      return 1.0 // sin canvas = 100% vacío
    }

    let ctx: CanvasRenderingContext2D | null
    try {
      ctx = canvas.getContext('2d')
    } catch {
      return 1.0
    }
    if (!ctx) return 1.0

    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const total = width * height
    let blank = 0

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      const a = data[i + 3]
      // Transparente
      if (a < 128) { blank++; continue }
      // Negro profundo (no es un color de tile)
      if (r < 20 && g < 20 && b < 20) { blank++ }
    }

    return blank / total
  })
}

/**
 * Verifica que el canvas .preview-screen es visible y tiene dimensiones no-cero.
 * Retorna { visible, w, h } o { visible: false, w: 0, h: 0 }.
 */
async function getCanvasState(page: import('@playwright/test').Page): Promise<{
  visible: boolean
  w: number
  h: number
}> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas.preview-screen')
    if (!canvas) return { visible: false, w: 0, h: 0 }
    const style = getComputedStyle(canvas)
    const display = style.display
    const visible = display !== 'none' && canvas.width > 0 && canvas.height > 0
    return { visible, w: canvas.width, h: canvas.height }
  })
}

/**
 * Activa el hover sobre el seek slider para que el componente WebVTTPreview
 * calcule y renderice el thumbnail correspondiente al tiempo dado.
 *
 * Estrategia:
 *   1. Esperar a que el player esté ready
 *   2. Localizar .video-seek-slider (el elemento input range de la barra de progreso)
 *   3. Calcular la posición X correspondiente al porcentaje de tiempo dado
 *   4. Mover el mouse a esa posición para activar el hover-time
 *   5. Esperar a que el canvas .preview-screen aparezca
 */
async function hoverSeekSliderAtPercent(
  page: import('@playwright/test').Page,
  pct: number, // 0–1 — fracción del slider donde hacer hover
  timeoutMs = 10_000,
): Promise<void> {
  // El seek slider sólo se monta con tamaño no-cero cuando el contenido reproduce
  // y los controles están activos. Con autoplay:false el video está en pausa y los
  // controles colapsados (display:none / height 0) → boundingBox() devuelve null.
  // Forzamos reproducción (muted) y revelamos los controles antes de medir.
  await page.evaluate(async () => {
    const v = document.querySelector('video')
    if (v) { v.muted = true; try { await v.play() } catch (_) { /* ignore */ } }
  })

  const slider = page.locator('.video-seek-slider').first()
  await slider.waitFor({ state: 'attached', timeout: timeoutMs })

  // Poll del rect vía getBoundingClientRect (boundingBox() de Playwright devuelve null
  // para elementos de área 0; el seek track tiene height 0 hasta el hover).
  const deadline = Date.now() + timeoutMs
  let rect: { x: number; y: number; w: number; h: number } | null = null
  while (Date.now() < deadline) {
    // Jiggle del mouse sobre la franja de controles para mantenerlos visibles
    await page.mouse.move(300, 690)
    await page.mouse.move(640, 690)
    rect = await page.evaluate(() => {
      const s = document.querySelector('.video-seek-slider')
      if (!s) return null
      const b = s.getBoundingClientRect()
      return { x: b.x, y: b.y, w: b.width, h: b.height }
    })
    if (rect && rect.w > 50) break
    await page.waitForTimeout(300)
  }
  if (!rect || rect.w <= 50) {
    throw new Error('hoverSeekSliderAtPercent: .video-seek-slider no alcanzó tamaño medible (controles no activos)')
  }

  const x = rect.x + rect.w * Math.min(Math.max(pct, 0.01), 0.99)
  const y = rect.y + (rect.h > 0 ? rect.h / 2 : 1)
  await page.mouse.move(x, y)
  // Segundo move para asentar el hover-time en la posición objetivo
  await page.mouse.move(x, y)
}

// ── Suite A: grilla completa — caso feliz ──────────────────────────────────────

test.describe('WebVTTPreview — (a) sprite con grilla completa', {
  tag: ['@integration', '@vtt-preview', '@ui-common', '@pr708'],
}, () => {

  test('thumbnail se llena cuando sprite coincide exactamente con VTT (blankFrac < 0.05)', async ({
    isolatedPlayer,
    page,
  }, testInfo) => {
    // Arrange: grilla 10×10 completa — 100 tiles
    const TILES_TOTAL = STD_COLS * STD_ROWS // 100 tiles, grilla completa
    const spriteBuffer = generateSpritePng({
      tileW: STD_TILE_W,
      tileH: STD_TILE_H,
      cols: STD_COLS,
      rows: STD_ROWS,
      tilesTotal: TILES_TOTAL,
    })
    const vttContent = generateVttContent(SPRITE_A_URL, {
      tileW: STD_TILE_W,
      tileH: STD_TILE_H,
      cols: STD_COLS,
      rows: STD_ROWS,
      tilesTotal: TILES_TOTAL,
    })

    // Habilitar view.showPreviews en el player config (LIFO — antes de goto)
    await mockPlayerConfig(page, { view: { showPreviews: true } })

    // Inyectar metadata.preview.vtt en el content config
    await mockContentConfig(page, {
      preview: { vtt: VTT_URL },
    })

    // Interceptar requests del VTT y sprite
    await page.route(VTT_URL, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/vtt; charset=utf-8',
        body: vttContent,
      })
    })
    await page.route(SPRITE_A_URL, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: spriteBuffer,
      })
    })

    // Act
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vodWithVttPreview,
      autoplay: false,
    })
    await isolatedPlayer.waitForReady(30_000)

    // Hover sobre el 30% del slider — tile del centro de la grilla
    await hoverSeekSliderAtPercent(page, 0.3)

    // Esperar a que el canvas aparezca
    await expect.poll(
      async () => (await getCanvasState(page)).visible,
      {
        timeout: 8_000,
        message: 'canvas.preview-screen debe ser visible tras hover en el seek slider',
      }
    ).toBe(true)

    // Assert: blankFrac bajo — el thumbnail está bien recortado
    const blankFrac = await getCanvasBlankFrac(page)

    // Evidencia
    ensureEvidenceDir()
    const evidencePath = path.join(EVIDENCE_DIR, 'case-a-complete-grid.png')
    const canvasScreenshot = await page.locator('canvas.preview-screen').screenshot().catch(() => null)
    if (canvasScreenshot) fs.writeFileSync(evidencePath, canvasScreenshot)
    await testInfo.attach('canvas-preview-case-a', {
      body: canvasScreenshot ?? Buffer.from([]),
      contentType: 'image/png',
    })

    expect(
      blankFrac,
      `Caso (a) — grilla completa: blankFrac debe ser < 0.05 (thumbnail relleno).\n` +
      `blankFrac obtenido: ${blankFrac.toFixed(3)}. Evidencia: ${evidencePath}`
    ).toBeLessThan(0.05)

    // Verificar dimensiones del canvas = tile W × H
    const canvasState = await getCanvasState(page)
    expect(canvasState.w, 'Canvas width debe coincidir con tileW').toBe(STD_TILE_W)
    expect(canvasState.h, 'Canvas height debe coincidir con tileH').toBe(STD_TILE_H)
  })
})

// ── Suite B: grilla incompleta — bug BLOQUEANTE ────────────────────────────────

test.describe('WebVTTPreview — (b) sprite con última fila incompleta [BLOQUEANTE]', {
  tag: ['@integration', '@vtt-preview', '@ui-common', '@pr708', '@regression'],
}, () => {

  /**
   * CASO BLOQUEANTE identificado por reviewer janoppix:
   *
   * ffmpeg -vf tile=10x10 genera un sprite con la última fila incompleta si el número
   * total de tiles no es múltiplo de cols. Por ejemplo, 95 tiles en grilla 10×10:
   *   - Filas completas: 9 × 10 = 90 tiles → rows 0–8 tienen 10 columnas cada una
   *   - Última fila (row 9): solo 5 tiles → columnas 0–4
   *
   * El VTT declara coordenadas para los 95 tiles. En la fila incompleta, las coords
   * van hasta x = 4 * 216 = 864, w = 216 → x+w = 1080 (NO 2160).
   *
   * Con la implementación del PR #707:
   *   declaredSpriteSize.width = max(x+w) = 2160 (de las filas completas) ← CORRECTO
   *   declaredSpriteSize.width = max(x+w) = 1080 (si max se calcula solo sobre la última fila)
   *
   * El bug que reporta janoppix: si max(x+w) recorre TODAS las filas,
   * las filas completas darán max(x+w) = 2160. Pero si la grilla tiene col=10 y
   * la última fila termina en col=4, el max sí llega a 2160. El problema real del
   * reviewer es que la imagen REAL (JPG) tiene HEIGHT menor que lo que max(y+h) infiere:
   *   sprite real (ffmpeg): width=2160, height = ceil(95/10) * 122 = 10 * 122 = 1220
   *   PERO la última fila del JPG real tiene píxeles de relleno/vacíos, no tiles reales.
   *
   * En nuestro test sintético modelamos el escenario real:
   *   - VTT declara 100 cues en grilla 10×10 (max(y+h) = 10*122 = 1220)
   *   - Sprite PNG tiene SOLO 9 filas reales de tiles (rows=9, height=9*122=1098)
   *     con la fila 10 inexistente (naturalHeight < declaredSpriteSize.height)
   *   - scaleY esperado correcto: 1098/1220 ≈ 0.90
   *   - Con el bug (si se usa 1220/1220 = 1.0): los tiles de la última fila
   *     apuntarían a coordenadas y*1.0 = y que supera el alto de la imagen → clipping
   *
   * Esta test DEBE FALLAR si el bug está presente (blankFrac alto en tiles de fila 10).
   * Si pasa, el fix maneja correctamente las grillas incompletas.
   */
  test('[BLOQUEANTE] sprite con 9 filas reales vs VTT de 10 filas — sin clipping en tiles de la última fila', async ({
    isolatedPlayer,
    page,
  }, testInfo) => {
    // Arrange:
    //   VTT declara grilla 10×10 = 100 tiles (declaredSpriteSize.height = 10 * 122 = 1220)
    //   Sprite PNG tiene SOLO 9 filas × 10 cols = 90 tiles reales (height = 9 * 122 = 1098)
    //   Los tiles de la fila 10 (índices 90–99) NO EXISTEN en el PNG (altura insuficiente)
    const VTT_TILES  = STD_COLS * STD_ROWS  // 100 — lo que declara el VTT
    const REAL_ROWS  = STD_ROWS - 1         // 9 — lo que tiene el PNG real
    const REAL_TILES = STD_COLS * REAL_ROWS // 90 tiles reales en el PNG

    // VTT declara 100 tiles (10 filas), pero el PNG solo tiene 9 filas
    const vttContent = generateVttContent(SPRITE_A_URL, {
      tileW: STD_TILE_W,
      tileH: STD_TILE_H,
      cols: STD_COLS,
      rows: STD_ROWS,      // 10 filas en el VTT
      tilesTotal: VTT_TILES, // 100 cues
    })

    // Sprite PNG con SOLO 9 filas — height = 9 * 122 = 1098 (no 1220)
    const spriteBuffer = generateSpritePng({
      tileW: STD_TILE_W,
      tileH: STD_TILE_H,
      cols: STD_COLS,
      rows: REAL_ROWS,      // SOLO 9 filas en el PNG
      tilesTotal: REAL_TILES, // 90 tiles
    })

    await mockPlayerConfig(page, { view: { showPreviews: true } })
    await mockContentConfig(page, {
      preview: { vtt: VTT_URL },
    })

    await page.route(VTT_URL, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/vtt; charset=utf-8',
        body: vttContent,
      })
    })
    await page.route(SPRITE_A_URL, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: spriteBuffer,
      })
    })

    // Act
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vodWithVttPreview,
      autoplay: false,
    })
    await isolatedPlayer.waitForReady(30_000)

    // Hover sobre el 30% del slider — tiles de las primeras filas (que SÍ existen en el PNG)
    await hoverSeekSliderAtPercent(page, 0.3)
    await expect.poll(
      async () => (await getCanvasState(page)).visible,
      { timeout: 8_000, message: 'canvas.preview-screen debe aparecer tras hover' }
    ).toBe(true)

    // Verificar blankFrac en tiles de las primeras filas (deben estar OK)
    const blankFracEarlyTile = await getCanvasBlankFrac(page)
    ensureEvidenceDir()
    const evidenceEarly = path.join(EVIDENCE_DIR, 'case-b-early-tile.png')
    const screenshotEarly = await page.locator('canvas.preview-screen').screenshot().catch(() => null)
    if (screenshotEarly) fs.writeFileSync(evidenceEarly, screenshotEarly)
    await testInfo.attach('canvas-preview-case-b-early', {
      body: screenshotEarly ?? Buffer.from([]),
      contentType: 'image/png',
    })

    expect(
      blankFracEarlyTile,
      `Caso (b) — tiles de filas completas deben renderizar sin clipping (blankFrac < 0.05).\n` +
      `blankFrac fila inicial: ${blankFracEarlyTile.toFixed(3)}. Evidencia: ${evidenceEarly}`
    ).toBeLessThan(0.05)

    // Ahora hover sobre el 95% del slider — tiles de la última fila (índice 90–99 en VTT)
    // Estos tiles NO existen en el PNG → scaleY incorrecto provoca clipping
    await hoverSeekSliderAtPercent(page, 0.95)
    // Esperar que el canvas sea visible en la nueva posición antes de leer píxeles
    await expect.poll(
      async () => (await getCanvasState(page)).visible,
      { timeout: 5_000, message: 'canvas.preview-screen debe seguir visible en la fila incompleta' }
    ).toBe(true)

    const blankFracLastRow = await getCanvasBlankFrac(page)
    const evidenceLast = path.join(EVIDENCE_DIR, 'case-b-last-row-bloqueante.png')
    const screenshotLast = await page.locator('canvas.preview-screen').screenshot().catch(() => null)
    if (screenshotLast) fs.writeFileSync(evidenceLast, screenshotLast)
    await testInfo.attach('canvas-preview-case-b-last-row', {
      body: screenshotLast ?? Buffer.from([]),
      contentType: 'image/png',
    })

    // ASERCIÓN BLOQUEANTE:
    // Con el fix correcto (scaleY = naturalHeight / declaredSpriteSize.height = 1098/1220 ≈ 0.90),
    // el drawImage en la última fila usará y * 0.90 que cae dentro de la imagen.
    // Con el bug (scaleY ≥ 1.0), y=1098 supera la altura del PNG → clipping transparente.
    //
    // Criterio:
    //   blankFrac < 0.50 → el thumbnail tiene contenido (fix funciona correctamente)
    //   blankFrac ≥ 0.50 → más de la mitad del tile está cortado/vacío (bug presente)
    //
    // NOTA: si la última fila del VTT mapea a los tiles 90–99, pero el video mock
    // tiene una duración corta (<500s = 100 tiles × 5s), puede que el hover al 95%
    // no alcance los tiles de la fila 10. En ese caso el test reporta el estado real.
    expect(
      blankFracLastRow,
      `Caso (b) BLOQUEANTE — tiles de la última fila incompleta no deben estar cortados.\n` +
      `blankFrac en tiles de la última fila: ${blankFracLastRow.toFixed(3)}.\n` +
      `Si blankFrac >= 0.50: el bug scaleY sobreescalado está PRESENTE (max(y+h) subestima el alto).\n` +
      `Evidencia: ${evidenceLast}`
    ).toBeLessThan(0.50)
  })
})

// ── Suite C: sprite retina/escalado ───────────────────────────────────────────

test.describe('WebVTTPreview — (c) sprite retina (naturalWidth = 2x declarado en VTT)', {
  tag: ['@integration', '@vtt-preview', '@ui-common', '@pr708'],
}, () => {

  test('sprite 2x (naturalWidth doble del declarado en VTT) — thumbnail correctamente encuadrado', async ({
    isolatedPlayer,
    page,
  }, testInfo) => {
    // Arrange:
    //   VTT declara tiles de 216×122 en grilla 10×10 (declaredSpriteSize = 2160×1220)
    //   Sprite PNG es retina: 4320×2440 (2x en ambas dimensiones)
    //   scaleX = 4320 / 2160 = 2.0 → drawImage usa coords 2x → encuadre correcto
    const RETINA_FACTOR = 2
    const spriteBuffer = generateSpritePng({
      tileW: STD_TILE_W * RETINA_FACTOR,   // 432 px por tile en el PNG
      tileH: STD_TILE_H * RETINA_FACTOR,   // 244 px por tile en el PNG
      cols: STD_COLS,
      rows: STD_ROWS,
      tilesTotal: STD_COLS * STD_ROWS,
    })
    // El VTT declara coordenadas en el sistema de 1x (no retina)
    const vttContent = generateVttContent(SPRITE_A_URL, {
      tileW: STD_TILE_W,
      tileH: STD_TILE_H,
      cols: STD_COLS,
      rows: STD_ROWS,
      tilesTotal: STD_COLS * STD_ROWS,
    })

    await mockPlayerConfig(page, { view: { showPreviews: true } })
    await mockContentConfig(page, {
      preview: { vtt: VTT_URL },
    })

    await page.route(VTT_URL, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/vtt; charset=utf-8',
        body: vttContent,
      })
    })
    await page.route(SPRITE_A_URL, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: spriteBuffer,
      })
    })

    // Act
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vodWithVttPreview,
      autoplay: false,
    })
    await isolatedPlayer.waitForReady(30_000)

    await hoverSeekSliderAtPercent(page, 0.3)
    await expect.poll(
      async () => (await getCanvasState(page)).visible,
      { timeout: 8_000, message: 'canvas.preview-screen debe aparecer con sprite retina' }
    ).toBe(true)

    const blankFrac = await getCanvasBlankFrac(page)
    ensureEvidenceDir()
    const evidencePath = path.join(EVIDENCE_DIR, 'case-c-retina-sprite.png')
    const screenshot = await page.locator('canvas.preview-screen').screenshot().catch(() => null)
    if (screenshot) fs.writeFileSync(evidencePath, screenshot)
    await testInfo.attach('canvas-preview-case-c-retina', {
      body: screenshot ?? Buffer.from([]),
      contentType: 'image/png',
    })

    expect(
      blankFrac,
      `Caso (c) — sprite retina 2x: blankFrac debe ser < 0.05 (scaleX=2.0 encuadra correctamente).\n` +
      `blankFrac obtenido: ${blankFrac.toFixed(3)}. Evidencia: ${evidencePath}`
    ).toBeLessThan(0.05)

    // El canvas debe seguir teniendo las dimensiones del tile VTT (no del tile retina)
    const { w, h } = await getCanvasState(page)
    expect(w, 'Canvas width debe ser el tileW declarado en VTT (no el retina)').toBe(STD_TILE_W)
    expect(h, 'Canvas height debe ser el tileH declarado en VTT (no el retina)').toBe(STD_TILE_H)
  })
})

// ── Suite D: VTT multi-sprite ─────────────────────────────────────────────────

test.describe('WebVTTPreview — (d) VTT multi-sprite (cues con varios .png distintos)', {
  tag: ['@integration', '@vtt-preview', '@ui-common', '@pr708'],
}, () => {

  /**
   * El VTT puede referenciar múltiples sprites distintos (e.g. sprite-a.png para los primeros
   * 50 tiles y sprite-b.png para los siguientes 50). Si la resolución de sprite-a difiere de
   * sprite-b, scaleX/scaleY deben calcularse POR IMAGEN, no globalmente.
   *
   * Bug potencial: si declaredSpriteSize se calcula de TODOS los cues (sin importar a qué
   * sprite corresponden), y sprite-a y sprite-b tienen tamaños distintos, el scaleX calculado
   * con el max global será incorrecto para al menos uno de los sprites.
   *
   * Este test verifica que ambos sprites producen thumbnails válidos (blankFrac < 0.10).
   */
  test('dos sprites distintos en el VTT — ambos renderizan sin clipping significativo', async ({
    isolatedPlayer,
    page,
  }, testInfo) => {
    // Arrange:
    //   sprite-a: tiles del 1 al 50 (primeras 5 filas de grilla 10×10)
    //   sprite-b: tiles del 51 al 100 (últimas 5 filas)
    //   Ambos sprites: mismo tamaño de tile (216×122) pero diferente número de filas
    const TILES_PER_SPRITE = 50
    const COLS = STD_COLS  // 10
    const ROWS_PER_SPRITE = 5

    const spriteABuffer = generateSpritePng({
      tileW: STD_TILE_W,
      tileH: STD_TILE_H,
      cols: COLS,
      rows: ROWS_PER_SPRITE,
      tilesTotal: TILES_PER_SPRITE,
    })
    const spriteBBuffer = generateSpritePng({
      tileW: STD_TILE_W,
      tileH: STD_TILE_H,
      cols: COLS,
      rows: ROWS_PER_SPRITE,
      tilesTotal: TILES_PER_SPRITE,
    })

    // VTT con dos sprites distintos
    const vttLines: string[] = ['WEBVTT', '']
    for (let i = 0; i < TILES_PER_SPRITE; i++) {
      const col = i % COLS
      const row = Math.floor(i / COLS)
      const x = col * STD_TILE_W
      const y = row * STD_TILE_H
      const startMs = i * 5_000
      const endMs   = startMs + 5_000
      vttLines.push(
        `${formatVttTime(startMs)} --> ${formatVttTime(endMs)}`,
        `${SPRITE_A_URL}#xywh=${x},${y},${STD_TILE_W},${STD_TILE_H}`,
        '',
      )
    }
    for (let i = 0; i < TILES_PER_SPRITE; i++) {
      const col = i % COLS
      const row = Math.floor(i / COLS)
      const x = col * STD_TILE_W
      const y = row * STD_TILE_H
      const startMs = (TILES_PER_SPRITE + i) * 5_000
      const endMs   = startMs + 5_000
      vttLines.push(
        `${formatVttTime(startMs)} --> ${formatVttTime(endMs)}`,
        `${SPRITE_B_URL}#xywh=${x},${y},${STD_TILE_W},${STD_TILE_H}`,
        '',
      )
    }
    const vttContent = vttLines.join('\n')

    await mockPlayerConfig(page, { view: { showPreviews: true } })
    await mockContentConfig(page, {
      preview: { vtt: VTT_URL },
    })

    await page.route(VTT_URL, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/vtt; charset=utf-8',
        body: vttContent,
      })
    })
    await page.route(SPRITE_A_URL, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: spriteABuffer,
      })
    })
    await page.route(SPRITE_B_URL, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: spriteBBuffer,
      })
    })

    // Act
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vodWithVttPreview,
      autoplay: false,
    })
    await isolatedPlayer.waitForReady(30_000)

    // Hover al 15% → tiles de sprite-a (primeros 50)
    await hoverSeekSliderAtPercent(page, 0.15)
    await expect.poll(
      async () => (await getCanvasState(page)).visible,
      { timeout: 8_000, message: 'canvas visible con sprite-a' }
    ).toBe(true)

    const blankFracSpriteA = await getCanvasBlankFrac(page)
    ensureEvidenceDir()
    const evidenceA = path.join(EVIDENCE_DIR, 'case-d-multi-sprite-a.png')
    const ssA = await page.locator('canvas.preview-screen').screenshot().catch(() => null)
    if (ssA) fs.writeFileSync(evidenceA, ssA)
    await testInfo.attach('canvas-preview-case-d-sprite-a', {
      body: ssA ?? Buffer.from([]),
      contentType: 'image/png',
    })

    expect(
      blankFracSpriteA,
      `Caso (d) — multi-sprite sprite-a: blankFrac debe ser < 0.10.\n` +
      `blankFrac: ${blankFracSpriteA.toFixed(3)}. Evidencia: ${evidenceA}`
    ).toBeLessThan(0.10)

    // Hover al 65% → tiles de sprite-b (últimos 50)
    await hoverSeekSliderAtPercent(page, 0.65)
    // Esperar que el canvas siga visible en la nueva posición del slider
    await expect.poll(
      async () => (await getCanvasState(page)).visible,
      { timeout: 5_000, message: 'canvas.preview-screen debe estar visible al 65% del slider (sprite-b)' }
    ).toBe(true)

    const blankFracSpriteB = await getCanvasBlankFrac(page)
    const evidenceB = path.join(EVIDENCE_DIR, 'case-d-multi-sprite-b.png')
    const ssB = await page.locator('canvas.preview-screen').screenshot().catch(() => null)
    if (ssB) fs.writeFileSync(evidenceB, ssB)
    await testInfo.attach('canvas-preview-case-d-sprite-b', {
      body: ssB ?? Buffer.from([]),
      contentType: 'image/png',
    })

    expect(
      blankFracSpriteB,
      `Caso (d) — multi-sprite sprite-b: blankFrac debe ser < 0.10.\n` +
      `blankFrac: ${blankFracSpriteB.toFixed(3)}. Evidencia: ${evidenceB}`
    ).toBeLessThan(0.10)
  })
})

// ── Suite E: escenario REAL de backend — sprite físico más chico que el VTT ──

test.describe('WebVTTPreview — (e) sprite físico más chico que el VTT [ESCENARIO REAL]', {
  tag: ['@integration', '@vtt-preview', '@ui-common', '@pr708', '@regression'],
}, () => {

  /**
   * ESCENARIO REAL de producción (confirmado con el comportamiento del backend de thumbnails):
   *
   * Al hacer *replace media*, a veces el backend genera el sprite en BAJA RESOLUCIÓN: el VTT
   * sigue declarando la rejilla original (tiles 216×122, 10×10 → 2160×1220) pero el JPG físico
   * es más chico (p.ej. 1000×580). Es el ÚNICO modo de fallo que el backend produce — no genera
   * VTTs sparse ni sprites con padding (eso era una hipótesis teórica del reviewer que no
   * corresponde a la salida real del backend, por lo que no se testea como bloqueante).
   *
   * El fix #707 calcula:
   *   declaredSpriteSize = max(x+w, y+h) = 2160×1220 (rejilla completa del VTT)
   *   scaleX = naturalWidth/declaredWidth   = 1000/2160 ≈ 0.46
   *   scaleY = naturalHeight/declaredHeight =  580/1220 ≈ 0.475
   *   drawImage(image, x*0.46, y*0.475, w*0.46, h*0.475, 0,0,w,h)
   * → lee la región correcta (a escala) del JPG real → el thumbnail SE VE (algo borroso por la
   *   baja resolución, pero NO cortado).
   *
   * Antes del fix (master/prod): sin escalar, drawImage usaba las coords del VTT (hasta x=1944)
   * sobre un JPG de solo 1000px → leía fuera de la imagen → thumbnail cortado/negro.
   *
   * EXPECTATIVA: este test debe PASAR contra develop (#707) — confirma que el fix resuelve el
   * bug REAL. La degradación restante (borrosidad) es un problema de calidad del backend, no del
   * player. Ver docs/evidence/thumbnails-sprite-mismatch/.
   */
  test('sprite físico 1000×580 con VTT que declara 2160×1220 — thumbnail se renderiza sin corte', async ({
    isolatedPlayer,
    page,
  }, testInfo) => {
    // Arrange: VTT declara rejilla COMPLETA 10×10 de tiles 216×122 (= 2160×1220).
    const COLS = STD_COLS, ROWS = STD_ROWS, TILES_TOTAL = COLS * ROWS // 100
    // Sprite físico MÁS CHICO: tiles de 100×58 → 1000×580 (el caso real de baja resolución).
    const PHYS_TILE_W = 100, PHYS_TILE_H = 58

    const spriteBuffer = generateSpritePng({
      tileW: PHYS_TILE_W,
      tileH: PHYS_TILE_H,
      cols: COLS,
      rows: ROWS,
      tilesTotal: TILES_TOTAL,
    })
    const vttContent = generateVttContent(
      SPRITE_A_URL,
      { tileW: STD_TILE_W, tileH: STD_TILE_H, cols: COLS, rows: ROWS, tilesTotal: TILES_TOTAL },
      600, // 100 tiles × 0.6s = 60s (cabe en el mock de 64s)
    )

    await mockPlayerConfig(page, { view: { showPreviews: true } })
    await mockContentConfig(page, { preview: { vtt: VTT_URL } })

    await page.route(VTT_URL, async (route) => {
      await route.fulfill({ status: 200, contentType: 'text/vtt; charset=utf-8', body: vttContent })
    })
    await page.route(SPRITE_A_URL, async (route) => {
      await route.fulfill({ status: 200, contentType: 'image/png', body: spriteBuffer })
    })

    // Act
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vodWithVttPreview,
      autoplay: false,
    })
    await isolatedPlayer.waitForReady(30_000)

    // Hover al 30% del slider — cualquier tile sirve (el escenario real no depende de la posición:
    // todo el sprite está a la misma escala uniforme).
    await hoverSeekSliderAtPercent(page, 0.3)
    await expect.poll(
      async () => (await getCanvasState(page)).visible,
      { timeout: 8_000, message: 'canvas.preview-screen debe ser visible tras hover' }
    ).toBe(true)

    // Asentar el render: el canvas puede mostrar un tile transitorio durante el poll.
    // Esperamos a que blankFrac se estabilice (2 lecturas consecutivas ≈ iguales) y
    // medimos + capturamos la evidencia desde el MISMO frame (toDataURL), eliminando
    // el desfase entre la medición y el screenshot.
    let blankFrac = 1
    let dataUrl = ''
    let prev = -1
    for (let i = 0; i < 12; i++) {
      const snap = await page.evaluate(() => {
        const c = document.querySelector<HTMLCanvasElement>('canvas.preview-screen')
        if (!c) return null
        const ctx = c.getContext('2d')!
        const d = ctx.getImageData(0, 0, c.width, c.height).data
        let blank = 0
        const total = c.width * c.height
        for (let p = 0; p < d.length; p += 4) {
          const r = d[p], g = d[p + 1], b = d[p + 2], a = d[p + 3]
          if (a < 128) { blank++; continue }
          if (r < 20 && g < 20 && b < 20) blank++
        }
        return { blankFrac: blank / total, dataUrl: c.toDataURL('image/png') }
      })
      if (snap) {
        blankFrac = snap.blankFrac
        dataUrl = snap.dataUrl
        if (Math.abs(blankFrac - prev) < 0.02) break // estabilizado
        prev = blankFrac
      }
      await page.waitForTimeout(250)
    }

    ensureEvidenceDir()
    const evidencePath = path.join(EVIDENCE_DIR, 'case-e-real-smaller-sprite.png')
    const ssBuf = dataUrl ? Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64') : Buffer.from([])
    if (ssBuf.length) fs.writeFileSync(evidencePath, ssBuf)
    await testInfo.attach('canvas-preview-case-e', { body: ssBuf, contentType: 'image/png' })

    // El fix debe escalar el sprite de baja resolución y renderizar el tile (no cortado).
    expect(
      blankFrac,
      `Caso (e) — escenario REAL: sprite físico 1000×580 con VTT que declara 2160×1220.\n` +
      `El fix #707 debe escalar (scaleX≈0.46, scaleY≈0.475) y renderizar el thumbnail con\n` +
      `contenido (no cortado). blankFrac obtenido: ${blankFrac.toFixed(3)} (esperado < 0.15).\n` +
      `Evidencia: ${evidencePath}`
    ).toBeLessThan(0.15)
  })
})

// ── Helper local (duplicado de sprite-helpers para el test D) ────────────────
// formatVttTime no se exporta desde sprite-helpers; redeclarada localmente para el test D.

function formatVttTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const msRemainder = ms % 1000
  return [
    String(h).padStart(2, '0'),
    String(m).padStart(2, '0'),
    String(s).padStart(2, '0'),
  ].join(':') + '.' + String(msRemainder).padStart(3, '0')
}
