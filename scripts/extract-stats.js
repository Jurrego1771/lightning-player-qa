#!/usr/bin/env node
/**
 * extract-stats.js — Lee playwright-report/report.json y produce un resumen
 * compacto con stats + listado de fallos.
 *
 * Uso:
 *   node scripts/extract-stats.js [ruta-al-report.json]
 *
 * Output: JSON a stdout con forma:
 * {
 *   total, passed, failed, flaky, skipped, duration_s,
 *   verdict: "SAFE" | "INVESTIGATE" | "FAIL",
 *   failures: [{ proj, file, title, error }]
 * }
 */

const fs   = require('fs')
const path = require('path')

const reportPath = process.argv[2] || 'playwright-report/report.json'

if (!fs.existsSync(reportPath)) {
  console.error(`[extract-stats] No encontré: ${reportPath}`)
  console.error('  Ejecuta los tests primero sin --reporter en CLI (usa config por defecto).')
  process.exit(1)
}

const data = JSON.parse(fs.readFileSync(reportPath, 'utf8'))
const s    = data.stats || {}

const total    = (s.expected || 0) + (s.unexpected || 0) + (s.flaky || 0) + (s.skipped || 0)
const passed   = s.expected  || 0
const failed   = s.unexpected || 0
const flaky    = s.flaky     || 0
const skipped  = s.skipped   || 0
const duration = Math.round((s.duration || 0) / 1000)

const failures = []

function walk(suites, filePath) {
  for (const suite of (suites || [])) {
    const file = suite.file || filePath || suite.title || ''
    for (const spec of (suite.specs || [])) {
      for (const t of (spec.tests || [])) {
        if (t.status === 'unexpected') {
          const firstErr = t.results?.[0]?.errors?.[0]?.message || ''
          failures.push({
            proj:  t.projectName || '',
            file:  path.basename(file),
            title: spec.title,
            error: firstErr.split('\n')[0].replace(/\x1b\[[0-9;]*m/g, '').slice(0, 160),
          })
        }
      }
    }
    walk(suite.suites, file)
  }
}

walk(data.suites)

// Veredicto simple basado en fallos
let verdict = 'SAFE'
if (failed > 0 && failed <= 10) verdict = 'INVESTIGATE'
if (failed > 10)                verdict = 'FAIL'

const out = { total, passed, failed, flaky, skipped, duration_s: duration, verdict, failures }
console.log(JSON.stringify(out, null, 2))
