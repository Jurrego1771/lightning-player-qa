/**
 * stream-health.ts — Verifica disponibilidad de streams externos.
 *
 * Hace GET requests en paralelo con timeout de 5s (GET es más confiable que HEAD — CDNs como Akamai bloquean HEAD desde Node.js).
 * El resultado se escribe en process.env para que los tests puedan
 * hacer test.skip() condicionalmente sin conocer la lógica de verificación.
 *
 * Env vars escritas (heredadas por todos los workers de Playwright):
 *   STREAM_HLS_VOD_SHORT_OK  — Streams.hls.vodShort (mux.dev)
 *   STREAM_HLS_VOD_OK        — Streams.hls.vod (akamai)
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
  playerScript:    'PLAYER_SCRIPT_OK',
  hlsVodShort:     'STREAM_HLS_VOD_SHORT_OK',
  hlsVod:          'STREAM_HLS_VOD_OK',
  dashVod:         'STREAM_DASH_VOD_OK',
} as const

// GET + immediate body abort — more reliable than HEAD since many CDNs block HEAD
// from non-browser user agents (e.g. Akamai returns 403 for HEAD, 200 for GET).
async function fetchHead(
  url: string
): Promise<{ ok: boolean; statusCode?: number; durationMs: number; error?: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  const start = Date.now()

  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' },
    })
    // Got status — drop body to avoid downloading the full stream
    res.body?.cancel().catch(() => {})
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
  const checks: Array<{ label: string; url: string; envKey: string }> = [
    {
      label:  'HLS VOD Short (mux.dev)',
      url:    'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
      envKey: STREAM_ENV_KEYS.hlsVodShort,
    },
    {
      label:  'HLS VOD (akamai)',
      url:    'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8',
      envKey: STREAM_ENV_KEYS.hlsVod,
    },
    {
      label:  'DASH VOD (akamai)',
      url:    'https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd',
      envKey: STREAM_ENV_KEYS.dashVod,
    },
  ]

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
