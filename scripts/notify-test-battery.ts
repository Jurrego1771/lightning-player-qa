import * as dotenv from 'dotenv'
import * as fs from 'fs'

dotenv.config()

const WEBHOOK_URL = process.env.SLACK_TEST_BATTERY_WEBHOOK_URL ?? ''

type CaseItem = {
  name: string
  tags?: string[]
}

type BatteryPayload = {
  feature: string
  file: string
  files?: string[]
  type?: string
  summary?: string[]
  smoke?: string[]
  regression?: string[]
  cases: CaseItem[]
}

function parseArgs(argv: string[]): BatteryPayload {
  const jsonPath = readOption(argv, '--json')
  if (jsonPath) return parseJsonFile(jsonPath)

  const feature = readOption(argv, '--feature')
  const file = readOption(argv, '--file')
  const type = readOption(argv, '--type') || 'integration'
  const cases = readRepeatedOption(argv, '--case').map((name) => ({ name }))

  validateTransport()

  if (!feature) throw new Error('Missing required option --feature')
  if (!file) throw new Error('Missing required option --file')
  if (cases.length === 0) throw new Error('At least one --case is required')

  return { feature, file, type, cases }
}

function parseJsonFile(jsonPath: string): BatteryPayload {
  validateTransport()

  const raw = fs.readFileSync(jsonPath, 'utf-8')
  const parsed = JSON.parse(raw) as Partial<BatteryPayload> & { cases?: Array<string | CaseItem> }

  if (!parsed.feature) throw new Error('JSON must include "feature"')
  if (!parsed.file) throw new Error('JSON must include "file"')
  if (!Array.isArray(parsed.cases) || parsed.cases.length === 0) {
    throw new Error('JSON must include a non-empty "cases" array')
  }

  return {
    feature: parsed.feature,
    file: parsed.file,
    files: Array.isArray((parsed as { files?: unknown[] }).files)
      ? ((parsed as { files?: unknown[] }).files ?? []).map(String)
      : [],
    type: parsed.type ?? 'integration',
    summary: Array.isArray(parsed.summary) ? parsed.summary.map(String) : [],
    smoke: Array.isArray(parsed.smoke) ? parsed.smoke.map(String) : [],
    regression: Array.isArray(parsed.regression) ? parsed.regression.map(String) : [],
    cases: parsed.cases.map(normalizeCaseItem),
  }
}

function normalizeCaseItem(item: string | CaseItem): CaseItem {
  if (typeof item === 'string') return { name: item }
  return {
    name: String(item.name),
    tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
  }
}

function validateTransport(): void {
  if (!WEBHOOK_URL) throw new Error('Missing env var SLACK_TEST_BATTERY_WEBHOOK_URL')
}

function readOption(argv: string[], name: string): string {
  const index = argv.indexOf(name)
  if (index === -1) return ''
  return argv[index + 1] ?? ''
}

function readRepeatedOption(argv: string[], name: string): string[] {
  const values: string[] = []
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === name) {
      const value = argv[i + 1]
      if (value) values.push(value)
    }
  }
  return values
}

function buildMainMessage(payload: BatteryPayload): string {
  return `:zap: Lightning-player-qa :battery: Nueva bateria de pruebas creada /${payload.feature}`
}

function buildSlackPayload(payload: BatteryPayload): {
  text: string
  attachments: Array<{ color: string; blocks: Array<Record<string, unknown>> }>
} {
  const text = buildMainMessage(payload)
  const fileText = payload.files?.length
    ? payload.files.map((item) => `• ${item}`).join('\n')
    : payload.file

  const detailFields = [
    {
      type: 'mrkdwn',
      text: `*Feature*\n/${payload.feature}`,
    },
    {
      type: 'mrkdwn',
      text: `*Tipo*\n${payload.type ?? 'integration'}`,
    },
    {
      type: 'mrkdwn',
      text: `*Archivo(s)*\n${fileText}`,
    },
    {
      type: 'mrkdwn',
      text: `*Casos*\n${payload.cases.length}`,
    },
    {
      type: 'mrkdwn',
      text: `*Smoke recomendados*\n${payload.smoke?.length ?? 0}`,
    },
    {
      type: 'mrkdwn',
      text: `*Regression recomendados*\n${payload.regression?.length ?? 0}`,
    },
  ]

  const coverageLines = payload.summary?.length
    ? payload.summary.map((item) => `• ${item}`).join('\n')
    : '• Sin resumen de cobertura'

  return {
    text,
    attachments: [
      {
        color: '#2EB67D',
        blocks: [
          {
            type: 'section',
            fields: detailFields,
          },
          {
            type: 'divider',
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Cobertura*\n${coverageLines}`,
            },
          },
        ],
      },
    ],
  }
}

async function postWebhook(payload: {
  text: string
  attachments: Array<{ color: string; blocks: Array<Record<string, unknown>> }>
}): Promise<void> {
  const response = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Slack webhook failed: ${response.status} ${response.statusText} - ${body}`)
  }
}

async function main(): Promise<void> {
  const payload = parseArgs(process.argv.slice(2))
  const slackPayload = buildSlackPayload(payload)

  await postWebhook(slackPayload)
  console.log(`Slack summary notification sent for ${payload.file}`)
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
})
