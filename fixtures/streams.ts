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

// ── IDs de contenido en la plataforma Mediastream (DEV) ──────────────────

export const ContentIds = {
  /** VOD de video — contenido corto (~2 min) para tests rápidos */
  vodShort: '69d2f1e0461dd502cd921ad6',

  /** VOD de video — contenido largo (>10 min) para tests de ABR y buffer */
  vodLong: '6900ffde6ddf33fd39a523ee',

  /** Stream en vivo activo — requiere accessToken (ver ContentAccess) */
  live: '6971288e64b2477e2b935259',

  /**
   * Stream DVR activo — mismo ID que live, mismo accessToken.
   * Pasarlo como type: 'dvr' en goto().
   */
  dvr: '6971288e64b2477e2b935259',

  /** Audio */
  audio: '698b4a88d9cc56fe7a404079',

  /** Radio — mismo ID que audio por ahora hasta confirmar ID dedicado */
  radio: '698b4a88d9cc56fe7a404079',

  /** Podcast — pendiente confirmar ID */
  podcast: 'TODO_PODCAST_ID',

  /** VOD con subtítulos en múltiples idiomas. */
  vodWithSubtitles: '69d3081d5493800312af8b6e',

  /** VOD con múltiples audio tracks — pendiente confirmar ID */
  vodMultiAudio: 'TODO_VOD_MULTI_AUDIO_ID',

  /**
   * VOD con ads: pre-roll + mid-roll a los 10s + post-roll.
   * Configurado en la plataforma con IMA.
   */
  vodWithAds: '6900fffb6ddf33fd39a5288e',
} as const

// ── Access tokens para contenido restringido ─────────────────────────────
//
// Algunos contenidos DEV requieren access_token para ser reproducidos.
// Usar como: player.goto({ type: 'live', id: ContentIds.live, ...ContentAccess.live })
//
// NUNCA commitear tokens de producción aquí. Estos son tokens de DEV.

export const ContentAccess: Partial<Record<keyof typeof ContentIds, { accessToken: string }>> = {
  live: {
    accessToken: 'clLCZenCE5zwB7wDmKVNbruQBFtM7JR0rw1GBNcVBPpWB8bF47wPtN7cwX8w6UKWmSzSBpBhVbG',
  },
  dvr: {
    accessToken: 'clLCZenCE5zwB7wDmKVNbruQBFtM7JR0rw1GBNcVBPpWB8bF47wPtN7cwX8w6UKWmSzSBpBhVbG',
  },
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
