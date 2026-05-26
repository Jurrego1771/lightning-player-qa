#!/usr/bin/env ts-node
/**
 * visual_diff.ts — Compara dos imágenes PNG y calcula el porcentaje de diferencia
 *
 * Uso:
 *   ts-node skills/visual_diff.ts --current actual.png --baseline baseline.png
 *   ts-node skills/visual_diff.ts --current actual.png --baseline baseline.png --threshold 0.02 --output diff.png
 *
 * Requiere: pixelmatch + pngjs (ver DEPS al final)
 */

import * as path from 'path'
import * as fs from 'fs'

// Carga dinámica para dar un error claro si no están instaladas
let pixelmatch: (
  img1: Buffer | Uint8Array, img2: Buffer | Uint8Array, output: Buffer | Uint8Array | null,
  width: number, height: number, options?: { threshold?: number; includeAA?: boolean }
) => number

let PNG: {
  sync: {
    read: (buffer: Buffer) => { width: number; height: number; data: Buffer }
    write: (png: { width: number; height: number; data: Buffer }) => Buffer
  }
  new (opts?: { width?: number; height?: number }): { width: number; height: number; data: Buffer }
}

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  pixelmatch = require('pixelmatch')
} catch {
  process.stderr.write(
    'ERROR: pixelmatch no está instalado.\n' +
    '  Instalar con: npm install pixelmatch pngjs @types/pngjs\n'
  )
  process.exit(1)
}

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  PNG = require('pngjs').PNG
} catch {
  process.stderr.write(
    'ERROR: pngjs no está instalado.\n' +
    '  Instalar con: npm install pixelmatch pngjs @types/pngjs\n'
  )
  process.exit(1)
}

interface DiffResult {
  pixel_diff_ratio: number
  pixel_diff_count: number
  total_pixels: number
  passed: boolean
  threshold: number
  current: string
  baseline: string
  output_path?: string
  error?: string
}

function die(msg: string): never {
  process.stderr.write(`ERROR: ${msg}\n`)
  process.exit(1)
}

function parseArgs(argv: string[]): {
  current: string
  baseline: string
  threshold: number
  outputPath?: string
} {
  const get = (flag: string) => {
    const idx = argv.indexOf(flag)
    return idx !== -1 ? argv[idx + 1] : undefined
  }

  const current = get('--current')
  if (!current) die('--current es requerido (ruta a la imagen actual)')

  const baseline = get('--baseline')
  if (!baseline) die('--baseline es requerido (ruta a la imagen de referencia)')

  return {
    current,
    baseline,
    threshold: parseFloat(get('--threshold') ?? '0.01'),
    outputPath: get('--output'),
  }
}

function resolvePath(p: string): string {
  const REPO_ROOT = path.resolve(__dirname, '..')
  return path.isAbsolute(p) ? p : path.join(REPO_ROOT, p)
}

async function main() {
  const { current, baseline, threshold, outputPath } = parseArgs(process.argv.slice(2))

  const currentAbs  = resolvePath(current)
  const baselineAbs = resolvePath(baseline)

  // Verificar existencia de archivos antes de operar
  if (!fs.existsSync(currentAbs)) {
    const result: DiffResult = {
      pixel_diff_ratio: 0, pixel_diff_count: 0, total_pixels: 0,
      passed: false, threshold, current, baseline,
      error: `missing_file: ${currentAbs}`,
    }
    console.log(JSON.stringify(result, null, 2))
    process.exit(1)
  }

  if (!fs.existsSync(baselineAbs)) {
    const result: DiffResult = {
      pixel_diff_ratio: 0, pixel_diff_count: 0, total_pixels: 0,
      passed: false, threshold, current, baseline,
      error: `missing_file: ${baselineAbs}`,
    }
    console.log(JSON.stringify(result, null, 2))
    process.exit(1)
  }

  // Leer imágenes
  const imgCurrent  = PNG.sync.read(fs.readFileSync(currentAbs))
  const imgBaseline = PNG.sync.read(fs.readFileSync(baselineAbs))

  // Si las dimensiones difieren, reportar error (no intentamos redimensionar)
  if (imgCurrent.width !== imgBaseline.width || imgCurrent.height !== imgBaseline.height) {
    const result: DiffResult = {
      pixel_diff_ratio: 1.0,
      pixel_diff_count: -1,
      total_pixels: imgBaseline.width * imgBaseline.height,
      passed: false,
      threshold,
      current,
      baseline,
      error: `dimension_mismatch: current=${imgCurrent.width}x${imgCurrent.height} baseline=${imgBaseline.width}x${imgBaseline.height}`,
    }
    console.log(JSON.stringify(result, null, 2))
    process.exit(1)
  }

  const { width, height } = imgBaseline
  const totalPixels = width * height

  // Buffer para la imagen diff (RGBA)
  const diffData = Buffer.alloc(width * height * 4)

  const pixelDiffCount = pixelmatch(
    imgCurrent.data,
    imgBaseline.data,
    diffData,
    width,
    height,
    { threshold, includeAA: false }
  )

  const pixelDiffRatio = totalPixels > 0 ? pixelDiffCount / totalPixels : 0
  const passed = pixelDiffRatio <= threshold

  // Guardar imagen diff si se solicita
  let savedOutputPath: string | undefined
  if (outputPath && diffData) {
    const outputAbs = resolvePath(outputPath)
    fs.mkdirSync(path.dirname(outputAbs), { recursive: true })

    // Construir PNG de diff manualmente
    const diffPng = new PNG({ width, height })
    diffPng.data = diffData
    fs.writeFileSync(outputAbs, PNG.sync.write(diffPng))
    savedOutputPath = path.relative(path.resolve(__dirname, '..'), outputAbs).replace(/\\/g, '/')
  }

  const result: DiffResult = {
    pixel_diff_ratio: parseFloat(pixelDiffRatio.toFixed(6)),
    pixel_diff_count: pixelDiffCount,
    total_pixels:     totalPixels,
    passed,
    threshold,
    current,
    baseline,
    ...(savedOutputPath ? { output_path: savedOutputPath } : {}),
  }

  console.log(JSON.stringify(result, null, 2))

  // Exit 1 si falló la comparación — facilita uso en CI
  if (!passed) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })

// DEPS: npm install pixelmatch pngjs @types/pngjs
