#!/usr/bin/env node
/**
 * serve-streams.js — Inicia el servidor de HLS fixtures en :9001
 *
 * Crea el directorio fixtures/streams/ si no existe (cross-platform)
 * antes de lanzar `npx serve`. Esto permite que Playwright arranque
 * el webServer correctamente en CI aunque los fixtures no se hayan
 * generado todavía (lo hace checkHlsFixtures en globalSetup si ffmpeg está disponible).
 */
const fs   = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const dir = path.join(__dirname, '..', 'fixtures', 'streams')
fs.mkdirSync(dir, { recursive: true })

const child = spawn('npx', ['serve', 'fixtures/streams', '-p', '9001', '--cors'], {
  stdio: 'inherit',
  shell: true,
})

child.on('exit', (code) => process.exit(code ?? 0))
