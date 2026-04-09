/**
 * streams.ts — Catálogo de contenido de test
 *
 * El Lightning Player carga contenido principalmente por ID de la plataforma
 * Mediastream. Los IDs de test son contenidos reales del ambiente DEV.
 *
 * REGLA: Nunca usar IDs ni streams de producción en tests automatizados.
 *
 * ── Sobre IDs vs src ──────────────────────────────────────────────────────
 * La API oficial usa `id` (ID de la plataforma):
 *   loadMSPlayer('container', { type: 'media', id: '5f7f563e...' })
 *
 * Contenido que requiere access token (live/dvr): usar ContentAccess[id]
 * para obtener el accessToken a pasar en goto().
 */

// ── IDs de contenido en la plataforma Mediastream ────────────────────────
//
// Los valores por defecto son IDs del ambiente DEV.
// En CI (staging/prod) se sobreescriben via variables de entorno:
//
//   CONTENT_ID_VOD_SHORT=<id>   CONTENT_ID_LIVE=<id>  ...
//
// Ver .env.example para el listado completo de variables.

const e = process.env

export const ContentIds = {
  /** VOD de video — contenido corto (~2 min) para tests rápidos */
  vodShort: e.CONTENT_ID_VOD_SHORT ?? '69d2f1e0461dd502cd921ad6',

  /** VOD de video — contenido largo (>10 min) para tests de ABR y buffer */
  vodLong: e.CONTENT_ID_VOD_LONG ?? '6900ffde6ddf33fd39a523ee',

  /** Stream en vivo activo — requiere accessToken (ver ContentAccess) */
  live: e.CONTENT_ID_LIVE ?? '6971288e64b2477e2b935259',

  /**
   * Stream DVR activo — mismo ID que live, mismo accessToken.
   * Pasarlo como type: 'dvr' en goto().
   */
  dvr: e.CONTENT_ID_DVR ?? '6971288e64b2477e2b935259',

  /** Audio */
  audio: e.CONTENT_ID_AUDIO ?? '698b4a88d9cc56fe7a404079',

  /** Radio — mismo ID que audio por ahora hasta confirmar ID dedicado */
  radio: e.CONTENT_ID_RADIO ?? '698b4a88d9cc56fe7a404079',

  /** Podcast — pendiente confirmar ID */
  podcast: e.CONTENT_ID_PODCAST ?? 'TODO_PODCAST_ID',

  /** VOD con subtítulos en múltiples idiomas */
  vodWithSubtitles: e.CONTENT_ID_VOD_WITH_SUBTITLES ?? '69d3081d5493800312af8b6e',

  /** VOD con múltiples audio tracks — pendiente confirmar ID */
  vodMultiAudio: e.CONTENT_ID_VOD_MULTI_AUDIO ?? 'TODO_VOD_MULTI_AUDIO_ID',

  /**
   * VOD con ads: pre-roll + mid-roll a los 10s + post-roll.
   * Configurado en la plataforma con IMA.
   */
  vodWithAds: e.CONTENT_ID_VOD_WITH_ADS ?? '6900fffb6ddf33fd39a5288e',
}

// ── Access tokens para contenido restringido ─────────────────────────────
//
// @deprecated No usar ContentAccess con token hardcodeado — expira y no escala.
//
// En su lugar: usar el fixture `contentAccess` en tests que necesiten
// contenido restringido. Genera un token fresco por test via la API.
//
//   test('live', async ({ player, contentAccess }) => {
//     await player.goto({ type: 'live', id: ContentIds.live, ...contentAccess.live })
//   })
//
// Requiere PLATFORM_API_TOKEN en .env. Ver .env.example para instrucciones.

export const ContentAccess: Partial<Record<keyof typeof ContentIds, { accessToken: string }>> = {
  live: { accessToken: '' },  // vacío intencionalmente — usar fixture contentAccess
  dvr:  { accessToken: '' },  // vacío intencionalmente — usar fixture contentAccess
}

// ── Streams externos (fallback para tests de integración pura) ────────────

export const ExternalStreams = {
  hls: {
    vodShort: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    vod: 'https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8',
    live: 'https://test-streams.mux.dev/tos_ismc/master.m3u8',
  },
  dash: {
    vod: 'https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd',
  },
  audio: {
    mp3: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
  },
} as const

export const Streams = ExternalStreams

// ── IDs mock para tests aislados con isolatedPlayer ──────────────────────
//
// Cuando se usa el fixture `isolatedPlayer`, la plataforma está mockeada y
// el player recibe JSON local apuntando a streams en localhost:9001.
// Estos IDs pueden ser cualquier string válido — no tienen que existir en la plataforma.

export const MockContentIds = {
  vod: 'mock-vod-1',
  live: 'mock-live-1',
  audio: 'mock-audio-1',
  episode: 'mock-episode-1',
} as const

// ── URLs de streams HLS locales (servidos por webServer en playwright.config.ts) ──
//
// Generados por: bash scripts/generate-fixtures.sh
// Servidos por: npx serve fixtures/streams -p 9001 --cors
// Los mock JSON de platform-responses/content/*.json apuntan a estas URLs.

export const LocalStreams = {
  hls: {
    vod: 'http://localhost:9001/vod/master.m3u8',
    audio: 'http://localhost:9001/audio/index.m3u8',
    withError: 'http://localhost:9001/vod-with-error/index.m3u8',
  },
} as const

// ── Perfiles de red (para tests de ABR con CDP throttling) ───────────────

export const NetworkProfiles = {
  broadband: {
    downloadThroughput: (25 * 1024 * 1024) / 8,
    uploadThroughput: (10 * 1024 * 1024) / 8,
    latency: 5,
  },
  mobile4G: {
    downloadThroughput: (20 * 1024 * 1024) / 8,
    uploadThroughput: (10 * 1024 * 1024) / 8,
    latency: 30,
  },
  degraded3G: {
    downloadThroughput: (500 * 1024) / 8,
    uploadThroughput: (250 * 1024) / 8,
    latency: 100,
  },
  almostOffline: {
    downloadThroughput: (50 * 1024) / 8,
    uploadThroughput: (20 * 1024) / 8,
    latency: 500,
  },
} as const
