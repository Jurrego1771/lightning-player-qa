#!/usr/bin/env ts-node
/**
 * get_pr_diff.ts — Obtiene el diff de un PR, branch o commit del repo del player
 *
 * Uso:
 *   ts-node skills/get_pr_diff.ts          → último commit
 *   ts-node skills/get_pr_diff.ts 42       → PR #42
 *   ts-node skills/get_pr_diff.ts feature/x → branch vs main
 *   ts-node skills/get_pr_diff.ts abc1234  → commit hash
 */

import * as path from 'path'
import * as fs from 'fs'
import { execSync } from 'child_process'
import * as dotenv from 'dotenv'

dotenv.config({ path: path.resolve(__dirname, '../.env') })

const PLAYER_GITHUB_REPO = process.env.PLAYER_GITHUB_REPO ?? ''
const PLAYER_LOCAL_REPO  = process.env.PLAYER_LOCAL_REPO  ?? ''

interface DiffFile {
  path: string
  additions: number
  deletions: number
  patch: string
}

interface DiffResult {
  ref: string
  type: 'pr' | 'branch' | 'commit'
  files: DiffFile[]
}

function die(msg: string): never {
  process.stderr.write(`ERROR: ${msg}\n`)
  process.exit(1)
}

function detectRefType(ref: string): 'pr' | 'branch' | 'commit' | 'latest' {
  if (!ref) return 'latest'
  if (/^\d+$/.test(ref)) return 'pr'
  if (/^[0-9a-f]{7,40}$/i.test(ref)) return 'commit'
  return 'branch'
}

function fetchPrDiff(prNumber: string): DiffFile[] {
  if (!PLAYER_GITHUB_REPO) die('PLAYER_GITHUB_REPO no configurado en .env')

  const raw = execSync(
    `gh pr diff ${prNumber} --repo ${PLAYER_GITHUB_REPO}`,
    { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }
  )
  return parseDiffText(raw)
}

function fetchBranchDiff(branch: string): DiffFile[] {
  if (!PLAYER_LOCAL_REPO) die('PLAYER_LOCAL_REPO no configurado en .env — necesario para diffs de branch')
  if (!fs.existsSync(PLAYER_LOCAL_REPO)) die(`Repo local no encontrado: ${PLAYER_LOCAL_REPO}`)

  const raw = execSync(
    `git -C "${PLAYER_LOCAL_REPO}" diff origin/main...origin/${branch} -- "*.js" "*.jsx" "*.ts" "*.cjs"`,
    { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }
  )
  return parseDiffText(raw)
}

function fetchCommitDiff(sha: string): DiffFile[] {
  if (!PLAYER_GITHUB_REPO) {
    // Fallback to local git show
    if (!PLAYER_LOCAL_REPO) die('Ni PLAYER_GITHUB_REPO ni PLAYER_LOCAL_REPO configurados en .env')
    const raw = execSync(
      `git -C "${PLAYER_LOCAL_REPO}" show ${sha} -- "*.js" "*.jsx" "*.ts" "*.cjs"`,
      { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }
    )
    return parseDiffText(raw)
  }

  const raw = execSync(
    `gh api /repos/${PLAYER_GITHUB_REPO}/commits/${sha} --jq '.files[]'`,
    { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }
  )

  // gh api returns newline-delimited JSON objects
  return raw
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const f = JSON.parse(line) as {
        filename: string
        additions: number
        deletions: number
        patch?: string
      }
      return {
        path: f.filename,
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch ?? '',
      }
    })
}

function fetchLatestCommitDiff(): DiffFile[] {
  if (!PLAYER_GITHUB_REPO) die('PLAYER_GITHUB_REPO no configurado en .env')

  const sha = execSync(
    `gh api /repos/${PLAYER_GITHUB_REPO}/commits --jq '.[0].sha'`,
    { encoding: 'utf8' }
  ).trim().replace(/"/g, '')

  return fetchCommitDiff(sha)
}

/**
 * Minimal unified diff parser — returns one entry per "diff --git a/... b/..." block.
 * Counts +/- lines and returns the full patch block.
 */
function parseDiffText(diffText: string): DiffFile[] {
  const files: DiffFile[] = []
  const blocks = diffText.split(/^diff --git /m).filter(Boolean)

  for (const block of blocks) {
    const lines = block.split('\n')
    // First line: "a/foo.ts b/foo.ts"
    const headerMatch = lines[0]?.match(/^a\/(.+?) b\//)
    const filePath = headerMatch ? headerMatch[1] : lines[0]?.split(' ')[0] ?? 'unknown'

    let additions = 0
    let deletions = 0
    const patchLines: string[] = []

    for (const line of lines.slice(1)) {
      if (line.startsWith('+') && !line.startsWith('+++')) { additions++; patchLines.push(line) }
      else if (line.startsWith('-') && !line.startsWith('---')) { deletions++; patchLines.push(line) }
      else { patchLines.push(line) }
    }

    files.push({ path: filePath, additions, deletions, patch: patchLines.join('\n') })
  }

  return files
}

async function main() {
  const ref = (process.argv[2] ?? '').trim()
  const refType = detectRefType(ref)

  let files: DiffFile[]
  let resolvedRef = ref

  try {
    switch (refType) {
      case 'pr':
        files = fetchPrDiff(ref)
        break
      case 'branch':
        files = fetchBranchDiff(ref)
        break
      case 'commit':
        files = fetchCommitDiff(ref)
        break
      case 'latest': {
        // Use latest commit SHA as the resolved ref
        if (PLAYER_GITHUB_REPO) {
          resolvedRef = execSync(
            `gh api /repos/${PLAYER_GITHUB_REPO}/commits --jq '.[0].sha'`,
            { encoding: 'utf8' }
          ).trim().replace(/"/g, '').slice(0, 7)
        }
        files = fetchLatestCommitDiff()
        break
      }
    }
  } catch (err) {
    die(`Falló la obtención del diff: ${(err as Error).message}`)
  }

  if (!files! || files!.length === 0) {
    process.stderr.write(`ERROR: Diff vacío para ref "${ref || 'latest'}". Verifica que la ref existe y tiene cambios en archivos .js/.ts.\n`)
    process.exit(1)
  }

  const result: DiffResult = {
    ref: resolvedRef || ref || 'latest',
    type: refType === 'latest' ? 'commit' : refType,
    files: files!,
  }

  console.log(JSON.stringify(result, null, 2))
}

main().catch(e => { console.error(e); process.exit(1) })
