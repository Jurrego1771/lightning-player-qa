#!/usr/bin/env ts-node
/**
 * retry_test.ts — Re-ejecuta un test de Playwright N veces y reporta resultados
 *
 * Uso:
 *   ts-node skills/retry_test.ts --test "tests/e2e/vod-playback.spec.ts::plays VOD" --retries 3
 *   ts-node skills/retry_test.ts --test "tests/e2e/vod-playback.spec.ts::plays VOD" --retries 5 --project chromium
 */

import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs'
import { execSync } from 'child_process'
import * as dotenv from 'dotenv'

dotenv.config({ path: path.resolve(__dirname, '../.env') })

const REPO_ROOT = path.resolve(__dirname, '..')

interface RetryResult {
  test_id:              string
  spec_file:            string
  test_title:           string
  project:              string
  attempts:             number
  passed:               number
  failed:               number
  is_confirmed_failure: boolean
  results:              Array<{ attempt: number; status: 'pass' | 'fail'; duration_ms: number; error?: string }>
}

function parseArgs(argv: string[]): { testId: string; retries: number; project: string } {
  let testId  = ''
  let retries = 3
  let project = 'chromium'

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--test'    && argv[i + 1]) { testId  = argv[++i]; continue }
    if (argv[i] === '--retries' && argv[i + 1]) { retries = parseInt(argv[++i], 10); continue }
    if (argv[i] === '--project' && argv[i + 1]) { project = argv[++i]; continue }
  }

  if (!testId) {
    process.stderr.write('ERROR: --test es requerido. Formato: "path/to/spec.ts::test title"\n')
    process.exit(1)
  }

  return { testId, retries: isNaN(retries) ? 3 : retries, project }
}

/** Escapa caracteres especiales de regex para usar en --grep */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function runAttempt(specFile: string, testTitle: string, project: string, attempt: number): {
  status: 'pass' | 'fail'
  duration_ms: number
  error?: string
} {
  // Write JSON output to a temp file so we can parse it deterministically
  const tmpDir  = path.join(os.tmpdir(), 'retry_test')
  const tmpJson = path.join(tmpDir, `attempt_${attempt}_${Date.now()}.json`)
  fs.mkdirSync(tmpDir, { recursive: true })

  const start = Date.now()

  const grep = escapeRegex(testTitle)
  const cmd = [
    'npx playwright test',
    `"${specFile}"`,
    `--grep "${grep}"`,
    `--project ${project}`,
    '--reporter=json',
    '--retries=0',
    `--output="${tmpJson}_artifacts"`,
  ].join(' ')

  // Set PLAYWRIGHT_JSON_OUTPUT_FILE so the JSON reporter writes to our tmp file
  const env = {
    ...process.env,
    PLAYWRIGHT_JSON_OUTPUT_FILE: tmpJson,
    CI: process.env.CI ?? 'true',
  }

  let exitCode = 0
  let stderr   = ''

  try {
    execSync(cmd, {
      cwd:      REPO_ROOT,
      encoding: 'utf8',
      env,
      stdio:    ['ignore', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024,
    })
  } catch (err: unknown) {
    exitCode = (err as NodeJS.ErrnoException & { status?: number }).status ?? 1
    stderr = (err as NodeJS.ErrnoException & { stderr?: string }).stderr ?? ''
  }

  const duration_ms = Date.now() - start

  // Try to parse the JSON reporter output for a definitive pass/fail
  let status: 'pass' | 'fail' = exitCode === 0 ? 'pass' : 'fail'
  let errorMsg: string | undefined

  try {
    if (fs.existsSync(tmpJson)) {
      const report = JSON.parse(fs.readFileSync(tmpJson, 'utf8')) as {
        stats?: { expected?: number; unexpected?: number }
        suites?: Array<{
          specs?: Array<{
            title?: string
            tests?: Array<{ status?: string; results?: Array<{ error?: { message?: string } }> }>
          }>
        }>
      }

      const unexpected = report.stats?.unexpected ?? 0
      const expected   = report.stats?.expected   ?? 0
      status = unexpected > 0 ? 'fail' : expected > 0 ? 'pass' : (exitCode === 0 ? 'pass' : 'fail')

      // Extract first error message if failed
      if (status === 'fail') {
        const allTests = (report.suites ?? [])
          .flatMap(s => s.specs ?? [])
          .flatMap(sp => sp.tests ?? [])
        const firstError = allTests
          .flatMap(t => t.results ?? [])
          .map(r => r.error?.message)
          .find(Boolean)
        if (firstError) errorMsg = firstError.split('\n')[0]
      }
    }
  } catch {
    // JSON parse failed — fall back to exit code
    if (status === 'fail' && stderr) {
      errorMsg = stderr.split('\n').find(l => l.includes('Error') || l.includes('failed'))?.trim()
    }
  } finally {
    // Cleanup temp file
    try { fs.unlinkSync(tmpJson) } catch { /* ignore */ }
    try { fs.rmSync(`${tmpJson}_artifacts`, { recursive: true, force: true }) } catch { /* ignore */ }
  }

  process.stderr.write(`  [attempt ${attempt}] ${status.toUpperCase()} (${duration_ms}ms)${errorMsg ? ` — ${errorMsg}` : ''}\n`)

  return { status, duration_ms, ...(errorMsg ? { error: errorMsg } : {}) }
}

async function main() {
  const { testId, retries, project } = parseArgs(process.argv.slice(2))

  // Parse test_id: "path/to/spec.ts::test title"
  const sep      = testId.indexOf('::')
  const specFile = sep !== -1 ? testId.slice(0, sep) : testId
  const testTitle = sep !== -1 ? testId.slice(sep + 2) : ''

  if (!testTitle) {
    process.stderr.write('ERROR: --test debe contener "::" seguido del título del test\n')
    process.stderr.write('  Ejemplo: --test "tests/e2e/vod-playback.spec.ts::plays VOD short"\n')
    process.exit(1)
  }

  process.stderr.write(`Reintentando: "${testTitle}" en ${specFile}\n`)
  process.stderr.write(`Project: ${project} | Retries: ${retries}\n\n`)

  const results: RetryResult['results'] = []
  let passed = 0
  let failed = 0

  for (let i = 1; i <= retries; i++) {
    const r = runAttempt(specFile, testTitle, project, i)
    results.push({ attempt: i, ...r })

    if (r.status === 'pass') {
      passed++
    } else {
      failed++
    }
  }

  const output: RetryResult = {
    test_id:              testId,
    spec_file:            specFile,
    test_title:           testTitle,
    project,
    attempts:             retries,
    passed,
    failed,
    is_confirmed_failure: failed === retries,
    results,
  }

  console.log(JSON.stringify(output, null, 2))
}

main().catch(e => { console.error(JSON.stringify({ error: (e as Error).message })); process.exit(1) })
