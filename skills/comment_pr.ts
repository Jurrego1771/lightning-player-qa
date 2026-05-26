#!/usr/bin/env ts-node
/**
 * comment_pr.ts — Comenta un PR del repo del player con el resultado del pipeline
 *
 * Uso:
 *   ts-node skills/comment_pr.ts --pr 42 --body "## Pipeline completado\n✅ 8/8 tests pasaron"
 *   ts-node skills/comment_pr.ts --pr 42 --body-file tmp/pipeline/report.md
 */

import * as path from 'path'
import * as fs from 'fs'
import { execSync } from 'child_process'
import * as dotenv from 'dotenv'

dotenv.config({ path: path.resolve(__dirname, '../.env') })

const REPO_ROOT          = path.resolve(__dirname, '..')
const PLAYER_GITHUB_REPO = process.env.PLAYER_GITHUB_REPO ?? ''

interface CommentPrResult {
  pr:          number
  comment_url: string
  error?:      string
}

function parseArgs(argv: string[]): { pr: number; body: string; bodyFile: string } {
  let pr       = 0
  let body     = ''
  let bodyFile = ''

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--pr'        && argv[i + 1]) { pr       = parseInt(argv[++i], 10); continue }
    if (argv[i] === '--body'      && argv[i + 1]) { body     = argv[++i]; continue }
    if (argv[i] === '--body-file' && argv[i + 1]) { bodyFile = argv[++i]; continue }
  }

  if (!pr || isNaN(pr)) {
    process.stderr.write('ERROR: --pr [número] es requerido\n')
    process.exit(1)
  }

  if (!body && !bodyFile) {
    process.stderr.write('ERROR: --body o --body-file es requerido\n')
    process.exit(1)
  }

  return { pr, body, bodyFile }
}

async function main() {
  const { pr, body: rawBody, bodyFile } = parseArgs(process.argv.slice(2))

  if (!PLAYER_GITHUB_REPO) {
    const output: CommentPrResult = {
      pr,
      comment_url: '',
      error: 'PLAYER_GITHUB_REPO no configurado en .env',
    }
    console.log(JSON.stringify(output, null, 2))
    process.exit(1)
  }

  // Resolve body content
  let body = rawBody

  if (bodyFile) {
    // Resolve relative paths from REPO_ROOT
    const resolvedPath = path.isAbsolute(bodyFile) ? bodyFile : path.join(REPO_ROOT, bodyFile)

    if (!fs.existsSync(resolvedPath)) {
      const output: CommentPrResult = {
        pr,
        comment_url: '',
        error: `--body-file no encontrado: ${resolvedPath}`,
      }
      console.log(JSON.stringify(output, null, 2))
      process.exit(1)
    }

    body = fs.readFileSync(resolvedPath, 'utf8')
    process.stderr.write(`Leyendo body desde: ${resolvedPath} (${body.length} chars)\n`)
  }

  if (!body.trim()) {
    const output: CommentPrResult = {
      pr,
      comment_url: '',
      error: 'El body del comentario está vacío',
    }
    console.log(JSON.stringify(output, null, 2))
    process.exit(1)
  }

  process.stderr.write(`Comentando PR #${pr} en ${PLAYER_GITHUB_REPO}\n`)

  // Write body to temp file to handle multiline content and special chars safely
  const tmpFile = path.join(require('os').tmpdir(), `gh_pr_comment_${pr}_${Date.now()}.md`)
  fs.writeFileSync(tmpFile, body, 'utf8')

  const cmd = `gh pr comment ${pr} --repo ${PLAYER_GITHUB_REPO} --body-file "${tmpFile}"`

  let raw = ''
  try {
    raw = execSync(cmd, {
      encoding:  'utf8',
      maxBuffer: 2 * 1024 * 1024,
      stdio:     ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch (err: unknown) {
    const errMsg = (err as NodeJS.ErrnoException & { stderr?: string }).stderr ?? (err as Error).message
    const output: CommentPrResult = {
      pr,
      comment_url: '',
      error: `gh pr comment falló: ${errMsg.trim()}`,
    }
    console.log(JSON.stringify(output, null, 2))
    process.exit(1)
  } finally {
    try { fs.unlinkSync(tmpFile) } catch { /* ignore */ }
  }

  // gh pr comment outputs the comment URL on stdout
  // Format: https://github.com/owner/repo/pull/42#issuecomment-123456789
  const commentUrl = raw.trim() || `https://github.com/${PLAYER_GITHUB_REPO}/pull/${pr}`

  process.stderr.write(`Comentario creado: ${commentUrl}\n`)

  const output: CommentPrResult = {
    pr,
    comment_url: commentUrl,
  }

  console.log(JSON.stringify(output, null, 2))
}

main().catch(e => { console.error(JSON.stringify({ error: (e as Error).message })); process.exit(1) })
