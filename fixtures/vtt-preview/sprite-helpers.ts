/**
 * sprite-helpers.ts — Generadores de sprites PNG y VTT para tests de WebVTTPreview
 *
 * Genera imágenes PNG sintéticas (rejilla de colores sólidos por tile) y archivos
 * WebVTT de referencia con coordenadas controladas. Diseñado para ser usado en tests
 * de integración que interceptan las requests del componente WebVTTPreview via page.route().
 *
 * No dependencias externas de imágenes — todo se construye en memoria usando pngjs.
 *
 * Contexto:
 *   El componente WebVTTPreview (PR #707) calcula:
 *     declaredSpriteSize = max(x+w, y+h) de todos los cues del VTT
 *     scaleX = image.naturalWidth / declaredSpriteSize.width
 *     scaleY = image.naturalHeight / declaredSpriteSize.height
 *   Y luego: ctx.drawImage(image, x*scaleX, y*scaleY, w*scaleX, h*scaleY, 0, 0, w, h)
 *
 *   El bug: con grillas incompletas (última fila con menos columnas), max(x+w) da el
 *   ancho de la ÚLTIMA FILA incompleta, no el ancho real del sprite.
 *   scaleX queda sobreescalado → clipping silencioso del canvas.
 */

import { PNG } from 'pngjs'

export interface SpriteConfig {
  /** Ancho de un tile individual en píxeles */
  tileW: number
  /** Alto de un tile individual en píxeles */
  tileH: number
  /** Número de columnas del sprite */
  cols: number
  /** Número de filas del sprite (puede ser incompleta en la última fila) */
  rows: number
  /**
   * Número total de tiles. Si tilesTotal < cols*rows, la última fila es incompleta.
   * Por defecto: cols * rows (grilla completa).
   */
  tilesTotal?: number
  /**
   * Filas FÍSICAS del PNG (puede ser mayor que `rows` para simular el padding de
   * `ffmpeg -vf tile`, que rellena la grilla a tamaño completo aunque el VTT solo
   * referencie las filas con frames reales). Default: `rows`.
   */
  imageRows?: number
  /**
   * Columnas FÍSICAS del PNG (análogo a imageRows para el ancho). Default: `cols`.
   */
  imageCols?: number
}

export interface VttCue {
  startMs: number
  endMs: number
  /** URL de la imagen del sprite (absoluta o relativa) */
  url: string
  x: number
  y: number
  w: number
  h: number
}

/**
 * Genera un PNG de sprite con tiles de colores distintos para verificar alineación.
 *
 * Cada tile tiene un color sólido único basado en su índice (cycled HSL-to-RGB).
 * El último tile de una grilla incompleta no existe en el PNG — el sprite tiene
 * solo las filas completas + la fila parcial visible.
 *
 * @returns Buffer PNG listo para servir vía page.route()
 */
export function generateSpritePng(config: SpriteConfig): Buffer {
  const { tileW, tileH, cols, rows } = config
  // Dimensiones FÍSICAS del PNG: por defecto coinciden con la rejilla del VTT,
  // pero pueden ser mayores (imageRows/imageCols) para simular el padding de ffmpeg.
  const imageCols = config.imageCols ?? cols
  const imageRows = config.imageRows ?? rows
  const width  = imageCols * tileW
  const height = imageRows * tileH
  const tilesTotal = config.tilesTotal ?? (cols * rows)

  const png = new PNG({ width, height, filterType: -1 })

  // Inicializar TODO el buffer físico a transparente de forma determinista.
  // (La región de padding — filas/columnas más allá de la rejilla del VTT — debe ser
  // transparente conocida, no bytes sin inicializar, para que los tests de clipping
  // distingan "padding leído por error" de "contenido real".)
  png.data.fill(0)

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const tileIndex = row * cols + col

      // Si el tile está fuera de los tiles reales, rellenar con negro transparente
      if (tileIndex >= tilesTotal) {
        for (let py = row * tileH; py < (row + 1) * tileH; py++) {
          for (let px = col * tileW; px < (col + 1) * tileW; px++) {
            const idx = (py * width + px) * 4
            png.data[idx]     = 0  // R
            png.data[idx + 1] = 0  // G
            png.data[idx + 2] = 0  // B
            png.data[idx + 3] = 0  // A (transparente)
          }
        }
        continue
      }

      // Color cíclico distintivo por tile: se usan 6 colores primarios/secundarios
      // para facilitar la verificación visual en evidencia de screenshots.
      const TILE_COLORS: [number, number, number][] = [
        [220,  50,  50], // rojo
        [ 50, 180,  50], // verde
        [ 50,  80, 220], // azul
        [220, 180,  50], // amarillo
        [220,  50, 180], // magenta
        [ 50, 200, 200], // cian
        [180, 120,  50], // naranja apagado
        [100,  50, 200], // violeta
        [ 50, 200, 120], // verde esmeralda
        [200, 100, 100], // salmón
      ]
      const [r, g, b] = TILE_COLORS[tileIndex % TILE_COLORS.length]

      for (let py = row * tileH; py < (row + 1) * tileH; py++) {
        for (let px = col * tileW; px < (col + 1) * tileW; px++) {
          const idx = (py * width + px) * 4
          png.data[idx]     = r
          png.data[idx + 1] = g
          png.data[idx + 2] = b
          png.data[idx + 3] = 255
        }
      }
    }
  }

  return PNG.sync.write(png)
}

/**
 * Genera un archivo VTT de thumbnails para un sprite dado.
 *
 * Produce cues con el formato:
 *   00:00:05.000 --> 00:00:10.000
 *   http://localhost:9001/vtt-preview/sprite.png#xywh=0,0,216,122
 *
 * @param spriteUrl  URL del sprite (interceptada vía page.route)
 * @param config     Configuración del sprite (debe coincidir con generateSpritePng)
 * @param cueDurationMs Duración de cada cue en ms (default: 5000 = 5s por tile)
 * @returns Contenido textual del VTT
 */
export function generateVttContent(
  spriteUrl: string,
  config: SpriteConfig,
  cueDurationMs = 5_000,
): string {
  const { tileW, tileH, cols } = config
  const tilesTotal = config.tilesTotal ?? (config.cols * config.rows)

  const lines: string[] = ['WEBVTT', '']

  for (let i = 0; i < tilesTotal; i++) {
    const col = i % cols
    const row = Math.floor(i / cols)
    const x = col * tileW
    const y = row * tileH

    const startMs = i * cueDurationMs
    const endMs   = startMs + cueDurationMs

    lines.push(
      `${formatVttTime(startMs)} --> ${formatVttTime(endMs)}`,
      `${spriteUrl}#xywh=${x},${y},${tileW},${tileH}`,
      '',
    )
  }

  return lines.join('\n')
}

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

/**
 * Retorna el tiempo en ms que corresponde al tile de índice `tileIndex`.
 * Útil para calcular a qué posición del video hacer hover para ver un tile específico.
 */
export function tileTimeMs(tileIndex: number, cueDurationMs = 5_000): number {
  // Usar el punto medio del cue para evitar edge cases en límites
  return tileIndex * cueDurationMs + Math.floor(cueDurationMs / 2)
}
