/**
 * environments.ts — Configuración centralizada de ambientes
 *
 * Tres ambientes del Lightning Player:
 *   dev     → develop branch — pruebas diarias, la mayoría del trabajo QA
 *   staging → rama staging (URL empieza con qa) — smoke post-deploy, raro
 *   prod    → producción — smoke mínimo post-deploy
 *
 * Uso: la variable de entorno PLAYER_ENV selecciona el ambiente.
 * Default: 'dev'
 */

export type Environment = 'dev' | 'staging' | 'prod'

export interface EnvironmentConfig {
  name: string
  playerScriptUrl: string
  description: string
  /**
   * Dominio al que el player script de este ambiente hace requests de plataforma.
   * El fixture `isolatedPlayer` intercepta este dominio con page.route() para
   * aislar los tests de la plataforma real.
   *
   * Verificado desde el código fuente del player (2026-04-08):
   *   dev  → develop.mdstrm.com
   *   prod → embed.mdstrm.com
   *   staging → pendiente confirmar con el player team
   */
  platformDomain: string
  /** Qué suite de tests aplica para este ambiente */
  testSuite: 'full' | 'smoke'
  /** Correr tests destructivos (ej: ads reales) en este ambiente */
  allowRealAds: boolean
}

export const ENVIRONMENTS: Record<Environment, EnvironmentConfig> = {
  dev: {
    name: 'Development',
    playerScriptUrl: 'https://player.cdn.mdstrm.com/lightning_player/develop/api.js',
    platformDomain: 'develop.mdstrm.com',
    description: 'Branch develop — ambiente principal para QA diario',
    testSuite: 'full',
    allowRealAds: false,
  },
  staging: {
    name: 'Staging',
    playerScriptUrl: 'https://player.cdn.mdstrm.com/lightning_player/staging/api.js',
    // TODO: confirmar dominio de staging con el player team.
    // El build de staging/api.js probablemente apunta a staging.mdstrm.com,
    // pero no fue verificado desde el código fuente. Actualizar cuando se confirme.
    platformDomain: 'staging.mdstrm.com',
    description: 'Staging (qa.*) — smoke test post-deploy antes de ir a prod',
    testSuite: 'smoke',
    allowRealAds: false,
  },
  prod: {
    name: 'Production',
    playerScriptUrl: 'https://player.cdn.mdstrm.com/lightning_player/api.js',
    platformDomain: 'embed.mdstrm.com',
    description: 'Producción — smoke mínimo post-deploy, nunca tests destructivos',
    testSuite: 'smoke',
    allowRealAds: false,
  },
}

export function getEnvironment(): Environment {
  const env = process.env.PLAYER_ENV as Environment
  if (env && env in ENVIRONMENTS) return env
  return 'dev'
}

export function getEnvironmentConfig(): EnvironmentConfig {
  return ENVIRONMENTS[getEnvironment()]
}
