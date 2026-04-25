/**
 * streams.ts — Catálogo de contenido de test (ambiente DEV)
 *
 * IDs de contenido reales del ambiente DEV de la plataforma Mediastream.
 * Este repo corre únicamente contra DEV — los IDs están hardcodeados aquí.
 *
 * Para actualizar un ID: editar directamente este archivo.
 *
 * Contenido que requiere access token (live/dvr): usar el fixture `contentAccess`
 * en lugar de pasar el token manualmente.
 */

export const ContentIds = {
  /** VOD de video — contenido corto (~2 min) para tests rápidos */
  vodShort: '69d2f1e0461dd502cd921ad6',

  /** VOD de video — contenido largo (>10 min) para tests de ABR y buffer */
  vodLong: '6900ffde6ddf33fd39a523ee',

  /** Stream en vivo activo — requiere accessToken (ver fixture contentAccess) */
  live: '664fb7b7e0e386591c300106',

  /**
   * Stream DVR activo — mismo ID que live, mismo accessToken.
   * Pasarlo como type: 'dvr' en goto().
   */
  dvr: '664fb7b7e0e386591c300106',

  /** Audio */
  audio: '698b4a88d9cc56fe7a404079',

  /** Radio — mismo ID que audio por ahora hasta confirmar ID dedicado */
  radio: '698b4a88d9cc56fe7a404079',

  /** Podcast — pendiente confirmar ID */
  podcast: 'TODO_PODCAST_ID',

  /** VOD con subtítulos en múltiples idiomas */
  vodWithSubtitles: '69d3081d5493800312af8b6e',

  /** VOD con múltiples audio tracks — pendiente confirmar ID */
  vodMultiAudio: 'TODO_VOD_MULTI_AUDIO_ID',

  /** VOD con ads: pre-roll + mid-roll a los 10s + post-roll */
  vodWithAds: '6900fffb6ddf33fd39a5288e',

  /** VOD DASH — stream con manifiesto MPD para tests de startup DASH */
  dashVod: '699afcb05a41925324fa4605',
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
    vod: 'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8',
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
  podcast: 'mock-podcast-1',
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
