#!/usr/bin/env ts-node
/**
 * create_gh_issue.ts — Crea un issue en el repo del player via gh CLI
 *
 * Uso:
 *   ts-node skills/create_gh_issue.ts --title "Bug en ads-ima" --body "Descripción..." --label bug --label high
 *   ts-node skills/create_gh_issue.ts --title "Test" --body "Body con\nnueva línea" --label bug
 */

import * as path from 'path'
import * as fs from 'fs'
import { execSync } from 'child_process'
import * as dotenv from 'dotenv'

dotenv.config({ path: path.resolve(__dirname, '../.env') })

const PLAYER_GITHUB_REPO = process.env.PLAYER_GITHUB_REPO ?? ''

interface CreateIssueResult {
  url:    string
  number: number
  title:  string
  error?: string
}

function parseArgs(argv: string[]): { title: string; body: string; labels: string[] } {
  let title  = ''
  let body   = ''
  const labels: string[] = []

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--title' && argv[i + 1]) { title = argv[++i]; continue }
    if (argv[i] === '--body'  && argv[i + 1]) { body  = argv[++i]; continue }
    if (argv[i] === '--label' && argv[i + 1]) { labels.push(argv[++i]); continue }
  }

  if (!title) {
    process.stderr.write('ERROR: --title es requerido\n')
    process.exit(1)
  }

  if (!body) {
    process.stderr.write('ERROR: --body es requerido\n')
    process.exit(1)
  }

  return { title, body, labels }
}

async function main() {
  const { title, body, labels } = parseArgs(process.argv.slice(2))

  if (!PLAYER_GITHUB_REPO) {
    const output: CreateIssueResult = {
      url:    '',
      number: 0,
      title,
      error:  'PLAYER_GITHUB_REPO no configurado en .env — necesario para crear issues en GitHub',
    }
    console.log(JSON.stringify(output, null, 2))
    process.exit(1)
  }

  process.stderr.write(`Creando issue en ${PLAYER_GITHUB_REPO}: "${title}"\n`)
  if (labels.length > 0) process.stderr.write(`Labels: ${labels.join(', ')}\n`)

  // Write body to a temp file to avoid shell escaping issues with multiline content
  const tmpFile = path.join(require('os').tmpdir(), `gh_issue_body_${Date.now()}.md`)
  fs.writeFileSync(tmpFile, body, 'utf8')

  // Build gh command — use --body-file to handle multiline bodies safely
  let cmd = `gh issue create --repo ${PLAYER_GITHUB_REPO} --title "${title.replace(/"/g, '\\"')}" --body-file "${tmpFile}"`

  for (const label of labels) {
    cmd += ` --label "${label.replace(/"/g, '\\"')}"`
  }

  let raw = ''
  try {
    raw = execSync(cmd, {
      encoding: 'utf8',
      maxBuffer: 1 * 1024 * 1024,
      stdio:    ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch (err: unknown) {
    // gh CLI prints the URL to stderr on success but exits 0
    // If it exits non-zero, it's a real error
    const errMsg = (err as NodeJS.ErrnoException & { stderr?: string }).stderr ?? (err as Error).message
    const output: CreateIssueResult = {
      url:    '',
      number: 0,
      title,
      error:  `gh issue create falló: ${errMsg.trim()}`,
    }
    console.log(JSON.stringify(output, null, 2))
    process.exit(1)
  } finally {
    try { fs.unlinkSync(tmpFile) } catch { /* ignore */ }
  }

  // gh issue create outputs the issue URL on stdout
  const issueUrl = raw.trim()

  // Extract issue number from URL: https://github.com/owner/repo/issues/123
  const numberMatch = issueUrl.match(/\/issues\/(\d+)$/)
  const issueNumber = numberMatch ? parseInt(numberMatch[1], 10) : 0

  process.stderr.write(`Issue creado: ${issueUrl}\n`)

  const output: CreateIssueResult = {
    url:    issueUrl,
    number: issueNumber,
    title,
  }

  console.log(JSON.stringify(output, null, 2))
}

main().catch(e => { console.error(JSON.stringify({ error: (e as Error).message })); process.exit(1) })
