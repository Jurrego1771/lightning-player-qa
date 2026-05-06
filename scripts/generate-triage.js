#!/usr/bin/env node
/**
 * generate-triage.js — Genera triage files en triage/test-corrections/ desde report.json
 *
 * Uso:
 *   node scripts/generate-triage.js                        → lee playwright-report/report.json
 *   node scripts/generate-triage.js --report path/to/report.json
 *
 * Por cada test fallido genera:
 *   triage/test-corrections/YYYY-MM-DD_[suite]-[test].json
 *
 * Con los campos que test-defect-corrector necesita para arrancar sin re-correr el test.
 */

const fs   = require('fs')
const path = require('path')

// ── Args ──────────────────────────────────────────────────────────────────────

const args        = process.argv.slice(2)
const reportFlag  = args.indexOf('--report')
const reportPath  = reportFlag !== -1
  ? args[reportFlag + 1]
  : path.join(process.cwd(), 'playwright-report', 'report.json')

const triageDir = path.join(process.cwd(), 'triage', 'test-corrections')

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

/** Extracts all failed specs recursively from the suite tree */
function collectFailures(suites, results = []) {
  for (const suite of suites) {
    for (const spec of (suite.specs || [])) {
      for (const test of (spec.tests || [])) {
        if (test.status !== 'expected' && test.status !== 'skipped') {
          results.push({ suite, spec, test })
        }
      }
    }
    if (suite.suites) collectFailures(suite.suites, results)
  }
  return results
}

/** Finds first attachment of given name in a result */
function findAttachment(result, name) {
  return (result.attachments || []).find(a => a.name === name)?.path ?? null
}

// ── Main ──────────────────────────────────────────────────────────────────────

if (!fs.existsSync(reportPath)) {
  console.error(`[generate-triage] report.json not found at: ${reportPath}`)
  console.error('  Run `npx playwright test` first, then re-run this script.')
  process.exit(1)
}

const report   = JSON.parse(fs.readFileSync(reportPath, 'utf8'))
const failures = collectFailures(report.suites || [])

if (failures.length === 0) {
  console.log('[generate-triage] No failed tests found. Nothing to triage.')
  process.exit(0)
}

fs.mkdirSync(triageDir, { recursive: true })

let created = 0

for (const { suite, spec, test } of failures) {
  // Pick the last result (most recent retry)
  const result = test.results[test.results.length - 1]
  if (!result) continue

  const errorObj    = (result.errors || [])[0] ?? {}
  const errorMsg    = errorObj.message ?? ''
  // Extract the line that actually failed (first line of stack that mentions the spec file)
  const specFile    = spec.file ?? ''
  const errorLine   = errorMsg
    .split('\n')
    .find(l => l.includes(specFile) || l.trim().startsWith('expect('))
    ?? errorMsg.split('\n')[0]
    ?? ''

  const tracePath      = findAttachment(result, 'trace')
  const screenshotPath = findAttachment(result, 'screenshot')

  const slug     = slugify(`${suite.title}-${spec.title}`.slice(0, 80))
  const filename = `${today()}_${slug}.json`
  const outPath  = path.join(triageDir, filename)

  // Skip if a triage file for this test already exists (same slug, any date)
  const existing = fs.readdirSync(triageDir).find(f => f.includes(slug))
  if (existing) {
    console.log(`[generate-triage] Already triaged: ${existing} — skipping`)
    continue
  }

  const triageData = {
    test_file:        specFile,
    test_title:       spec.title,
    suite_title:      suite.title,
    project:          test.projectName ?? '',
    status:           result.status,
    retry_count:      result.retry ?? 0,
    duration_ms:      result.duration ?? 0,
    error_message:    errorMsg.slice(0, 2000),   // cap at 2k chars — full error is in trace
    error_line:       errorLine.trim(),
    trace_path:       tracePath,
    screenshot_path:  screenshotPath,
    suspected_cause:  '',                         // human fills this in optionally
    generated_at:     new Date().toISOString(),
  }

  fs.writeFileSync(outPath, JSON.stringify(triageData, null, 2) + '\n', 'utf8')
  console.log(`[generate-triage] Created: ${filename}`)
  created++
}

console.log(`\n[generate-triage] Done — ${created} triage file(s) created in triage/test-corrections/`)
if (created > 0) {
  console.log('  Next: invoke test-defect-corrector agent to fix them.')
}
