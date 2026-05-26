#!/usr/bin/env ts-node
/**
 * write_test_file.ts — Escribe un nuevo spec file con validación básica
 *
 * Uso:
 *   ts-node skills/write_test_file.ts --path tests/e2e/mi-test.spec.ts --content <base64>
 *   ts-node skills/write_test_file.ts --path tests/e2e/mi-test.spec.ts --content -   ← lee de stdin
 *   ts-node skills/write_test_file.ts --path tests/e2e/mi-test.spec.ts --content @/tmp/content.ts
 *
 * Validaciones:
 *   - El archivo debe importar desde fixtures/ (no de @playwright/test directamente)
 *   - No se permite sobreescribir specs existentes sin --force
 */

import * as path from 'path'
import * as fs from 'fs'

const REPO_ROOT = path.resolve(__dirname, '..')

interface WriteResult {
  path: string
  created: boolean
  size_bytes: number
}

function die(msg: string): never {
  process.stderr.write(`ERROR: ${msg}\n`)
  process.exit(1)
}

function parseArgs(argv: string[]): {
  filePath: string
  contentSource: string
  force: boolean
} {
  const get = (flag: string) => {
    const idx = argv.indexOf(flag)
    return idx !== -1 ? argv[idx + 1] : undefined
  }

  const filePath = get('--path')
  if (!filePath) die('--path es requerido. Ej: --path tests/e2e/mi-test.spec.ts')

  const contentSource = get('--content')
  if (!contentSource) die('--content es requerido. Usa "-" para leer desde stdin, "@/ruta" para archivo, o base64.')

  return {
    filePath,
    contentSource,
    force: argv.includes('--force'),
  }
}

function readContent(source: string): string {
  if (source === '-') {
    // Leer de stdin (síncrono — bloquea hasta EOF)
    const chunks: Buffer[] = []
    const fd = fs.openSync('/dev/stdin', 'r')
    // En Windows no hay /dev/stdin — usar fd 0
    const stdinFd = process.platform === 'win32' ? 0 : fd
    const buf = Buffer.alloc(65536)
    let bytes: number
    try {
      while ((bytes = fs.readSync(stdinFd, buf, 0, buf.length, null)) > 0) {
        chunks.push(buf.slice(0, bytes))
      }
    } catch {
      // EOF o error de lectura — usar lo que se leyó
    }
    return Buffer.concat(chunks).toString('utf8')
  }

  if (source.startsWith('@')) {
    // Leer desde archivo de texto
    const srcPath = source.slice(1)
    if (!fs.existsSync(srcPath)) die(`Archivo fuente no encontrado: ${srcPath}`)
    return fs.readFileSync(srcPath, 'utf8')
  }

  // Intentar base64 primero; si falla, asumir que es texto plano
  try {
    const decoded = Buffer.from(source, 'base64').toString('utf8')
    // Heurística: si el decoded tiene caracteres de código TypeScript, es base64 válido
    if (decoded.includes('import') || decoded.includes('test(') || decoded.includes('describe(')) {
      return decoded
    }
  } catch { /* no era base64 */ }

  // Tratar como texto plano (útil en tests manuales)
  return source
}

/**
 * Valida que el spec file cumple las convenciones del proyecto.
 * Regla principal: importar desde fixtures/, nunca de @playwright/test directamente.
 */
function validateContent(content: string, filePath: string): string[] {
  const errors: string[] = []

  // Regla 1: No importar directamente de @playwright/test
  // Salvo que sea un helper/util, no un spec
  const isSpec = filePath.includes('.spec.ts') || filePath.includes('/tests/')
  if (isSpec && /from\s+['"]@playwright\/test['"]/m.test(content)) {
    errors.push(
      'El spec importa de @playwright/test directamente. ' +
      'Debe importar desde fixtures/ (ej: import { test, expect } from "fixtures/index")'
    )
  }

  // Regla 2: Debe tener al menos un import de fixtures/
  if (isSpec && !content.includes('fixtures/') && !content.includes('fixtures\\')) {
    errors.push(
      'El spec no importa nada desde fixtures/. ' +
      'Agrega: import { test, expect } from "../fixtures/index" (ajusta la ruta relativa)'
    )
  }

  // Regla 3: Debe tener al menos un test() o it()
  if (isSpec && !/\btest\s*\(|\bit\s*\(/.test(content)) {
    errors.push('El archivo no contiene ningún test() o it() — ¿está incompleto?')
  }

  return errors
}

async function main() {
  const { filePath, contentSource, force } = parseArgs(process.argv.slice(2))

  // Resolver path — puede ser relativo al repo root o absoluto
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.join(REPO_ROOT, filePath)

  // No permitir sobreescritura sin --force
  if (fs.existsSync(absolutePath) && !force) {
    die(
      `El archivo ya existe: ${absolutePath}\n` +
      '  Usa --force para sobreescribir, o elige otro --path.'
    )
  }

  const content = readContent(contentSource)

  if (!content.trim()) die('El contenido está vacío')

  // Validar
  const errors = validateContent(content, filePath)
  if (errors.length > 0) {
    process.stderr.write('ERROR: El spec no cumple las convenciones del proyecto:\n')
    for (const e of errors) process.stderr.write(`  - ${e}\n`)
    process.exit(1)
  }

  // Crear directorios intermedios
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true })

  // Escribir
  fs.writeFileSync(absolutePath, content, 'utf8')

  const relPath = path.relative(REPO_ROOT, absolutePath).replace(/\\/g, '/')
  const result: WriteResult = {
    path: relPath,
    created: true,
    size_bytes: Buffer.byteLength(content, 'utf8'),
  }

  console.log(JSON.stringify(result, null, 2))
}

main().catch(e => { console.error(e); process.exit(1) })
