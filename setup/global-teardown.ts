/**
 * global-teardown.ts — Post-suite cleanup
 *
 * Corre UNA VEZ después de que todos los tests terminan.
 * Escribe un JSON de resumen en playwright-report/ para que CI
 * lo pueda incluir como artefacto junto al HTML report.
 */
import * as fs from 'fs'
import * as path from 'path'
import { STREAM_ENV_KEYS } from './checks/stream-health'

export default async function globalTeardown(): Promise<void> {
  const reportDir = path.resolve(process.cwd(), 'playwright-report')
  if (!fs.existsSync(reportDir)) return

  const summary = {
    timestamp: new Date().toISOString(),
    environment: process.env.PLAYER_ENV ?? 'dev',
    streams: Object.fromEntries(
      Object.entries(STREAM_ENV_KEYS).map(([key, envKey]) => [
        key,
        process.env[envKey] === 'true',
      ])
    ),
  }

  fs.writeFileSync(
    path.join(reportDir, 'health-summary.json'),
    JSON.stringify(summary, null, 2)
  )
}
