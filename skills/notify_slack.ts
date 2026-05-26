#!/usr/bin/env ts-node
/**
 * notify_slack.ts — Envía notificación a Slack via webhook
 *
 * Uso:
 *   ts-node skills/notify_slack.ts --message "Pipeline completado: 8/8 tests pasaron"
 *   ts-node skills/notify_slack.ts --message "3 tests fallaron" --severity warning --channel "#qa-alerts"
 *   ts-node skills/notify_slack.ts --message "Build crítico" --severity critical
 *
 * Si SLACK_WEBHOOK no está configurado: exit 0 silencioso (no es error crítico).
 */

import * as https from 'https'
import * as path from 'path'
import * as dotenv from 'dotenv'

dotenv.config({ path: path.resolve(__dirname, '../.env') })

type Severity = 'info' | 'warning' | 'critical'

const SEVERITY_COLORS: Record<Severity, string> = {
  info:     'good',      // green
  warning:  'warning',   // yellow
  critical: 'danger',    // red
}

const SEVERITY_EMOJIS: Record<Severity, string> = {
  info:     ':white_check_mark:',
  warning:  ':warning:',
  critical: ':red_circle:',
}

interface NotifyResult {
  sent:    boolean
  channel: string
  error?:  string
}

function parseArgs(argv: string[]): { message: string; channel: string; severity: Severity } {
  let message  = ''
  let channel  = '#qa-alerts'
  let severity: Severity = 'info'

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--message'  && argv[i + 1]) { message  = argv[++i]; continue }
    if (argv[i] === '--channel'  && argv[i + 1]) { channel  = argv[++i]; continue }
    if (argv[i] === '--severity' && argv[i + 1]) {
      const s = argv[++i]
      if (s === 'info' || s === 'warning' || s === 'critical') {
        severity = s
      } else {
        process.stderr.write(`WARN: Severity desconocida "${s}" — usando "info"\n`)
      }
      continue
    }
  }

  if (!message) {
    process.stderr.write('ERROR: --message es requerido\n')
    process.exit(1)
  }

  return { message, channel, severity }
}

/** Makes an HTTPS POST request and returns a Promise with the response body */
function httpsPost(url: string, body: string): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)

    const options: https.RequestOptions = {
      hostname: parsed.hostname,
      port:     443,
      path:     parsed.pathname + parsed.search,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }

    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (chunk: string) => { data += chunk })
      res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, body: data }))
    })

    req.on('error', reject)
    req.setTimeout(10000, () => {
      req.destroy(new Error('Request timeout after 10s'))
    })

    req.write(body)
    req.end()
  })
}

async function main() {
  const { message, channel, severity } = parseArgs(process.argv.slice(2))

  const webhookUrl = process.env.SLACK_WEBHOOK ?? ''

  // Silent exit if webhook not configured — not a critical error
  if (!webhookUrl) {
    process.stderr.write('INFO: SLACK_WEBHOOK no configurado — omitiendo notificación Slack\n')
    const output: NotifyResult = { sent: false, channel }
    console.log(JSON.stringify(output, null, 2))
    return  // exit 0
  }

  const emoji = SEVERITY_EMOJIS[severity]
  const color = SEVERITY_COLORS[severity]
  const timestamp = Math.floor(Date.now() / 1000)

  // Slack message payload using attachments format (compatible with all Slack plans)
  const payload = {
    username:    'Lightning Player QA',
    icon_emoji:  ':test_tube:',
    channel,
    attachments: [
      {
        color,
        fallback:   `${emoji} ${message}`,
        text:       `${emoji} ${message}`,
        footer:     'Lightning Player QA Pipeline',
        footer_icon: 'https://platform.slack-edge.com/img/default_application_icon.png',
        ts:          timestamp,
        mrkdwn_in:  ['text'],
      },
    ],
  }

  const body = JSON.stringify(payload)

  process.stderr.write(`Enviando notificación Slack [${severity}]: "${message}"\n`)

  try {
    const response = await httpsPost(webhookUrl, body)

    if (response.statusCode !== 200 || response.body !== 'ok') {
      const output: NotifyResult = {
        sent:    false,
        channel,
        error:   `Slack webhook respondió con status ${response.statusCode}: ${response.body}`,
      }
      console.log(JSON.stringify(output, null, 2))
      // Don't exit 1 — Slack failure is not a critical pipeline error
      return
    }

    process.stderr.write('Notificación Slack enviada\n')

    const output: NotifyResult = { sent: true, channel }
    console.log(JSON.stringify(output, null, 2))

  } catch (err) {
    const output: NotifyResult = {
      sent:    false,
      channel,
      error:   `Error enviando a Slack: ${(err as Error).message}`,
    }
    console.log(JSON.stringify(output, null, 2))
    // Don't exit 1 — Slack failure is not a critical pipeline error
  }
}

main().catch(e => { console.error(JSON.stringify({ error: (e as Error).message })); process.exit(1) })

// NUEVAS DEPS NECESARIAS: npm install js-yaml @types/js-yaml
// (pixelmatch y pngjs son para visual_diff.ts: npm install pixelmatch pngjs @types/pngjs)
