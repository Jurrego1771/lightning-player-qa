/**
 * stream-health.ts — Verifica disponibilidad de streams externos.
 *
 * Hace HEAD requests en paralelo con timeout de 5s.
 * El resultado se escribe en process.env para que los tests puedan
 * hacer test.skip() condicionalmente sin conocer la lógica de verificación.
 *
 * Env vars escritas (heredadas por todos los workers de Playwright):
 *   STREAM_HLS_VOD_SHORT_OK  — Streams.hls.vodShort (mux.dev)
 *   STREAM_HLS_VOD_OK        — Streams.hls.vod (akamai)
 *   STREAM_HLS_LIVE_OK       — Streams.hls.live (mux.dev)
 *   STREAM_DASH_VOD_OK       — Streams.dash.vod (akamai)
 *   PLAYER_SCRIPT_OK         — Player script CDN
 */
const TIMEOUT_MS = 5_000

export interface StreamCheckResult {
  label: string
  url: string
  ok: boolean
  statusCode?: number
  durationMs: number
  error?: string
}

/** Env var names escritos por este módulo. Importar desde tests para evitar typos. */
export const STREAM_ENV_KEYS = {
  playerScript: 'PLAYER_SCRIPT_OK',
} as const

async function fetchHead(
  url: string
): Promise<{ ok: boolean; statusCode?: number; durationMs: number; error?: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  const start = Date.now()

  try {
    const res = await fetch(url, { method: 'HEAD', signal: controller.signal })
    return { ok: res.ok, statusCode: res.status, durationMs: Date.now() - start }
  } catch (err: unknown) {
    const isTimeout = (err as Error)?.name === 'AbortError'
    return {
      ok: false,
      durationMs: Date.now() - start,
      error: isTimeout ? 'timeout' : (err instanceof Error ? err.message : 'unknown'),
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function checkExternalStreams(playerScriptUrl?: string): Promise<StreamCheckResult[]> {
  // Solo chequeamos el player script CDN — los ExternalStreams de terceros (Mux, Akamai)
  // no se usan en ningún test activo (los tests usan ContentIds o LocalStreams).
  const checks: Array<{ label: string; url: string; envKey: string }> = []

  if (playerScriptUrl) {
    checks.push({
      label: 'Player script CDN',
      url: playerScriptUrl,
      envKey: STREAM_ENV_KEYS.playerScript,
    })
  }

  // All checks run in parallel — total time = slowest check, not sum
  const settled = await Promise.allSettled(
    checks.map(async c => {
      const res = await fetchHead(c.url)
      process.env[c.envKey] = res.ok ? 'true' : 'false'
      return { label: c.label, url: c.url, ...res } satisfies StreamCheckResult
    })
  )

  return settled.map((r, i) => {
    if (r.status === 'fulfilled') return r.value
    // fetchHead shouldn't reject, but handle it anyway
    process.env[checks[i].envKey] = 'false'
    return {
      label: checks[i].label,
      url: checks[i].url,
      ok: false,
      durationMs: 0,
      error: 'rejected',
    }
  })
}
