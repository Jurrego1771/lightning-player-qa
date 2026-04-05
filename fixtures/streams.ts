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
 * `src` es un HTML5 attribute del player (get/set después de init).
 * Para tests de integración que validan ABR o comportamientos de stream
 * puros (sin plataforma), se puede usar src como fallback.
 *
 * TODO: Completar con IDs reales del ambiente DEV cuando estén disponibles.
 * Preguntar a jurrego1771 por contenidos de test representativos.
 */

// ── IDs de contenido en la plataforma Mediastream (DEV) ──────────────────
//
// PENDIENTE: Reemplazar los placeholders con IDs reales del ambiente dev.
// Cada tipo de contenido necesita al menos un ID de test estable.

export const ContentIds = {
  /** VOD de video — contenido corto (~2 min) para tests rápidos */
  vodShort: 'TODO_VOD_SHORT_ID',

  /** VOD de video — contenido largo (>10 min) para tests de ABR y buffer */
  vodLong: 'TODO_VOD_LONG_ID',

  /** Stream en vivo activo */
  live: 'TODO_LIVE_ID',

  /** Stream DVR activo */
  dvr: 'TODO_DVR_ID',

  /** Audio / Radio */
  audio: 'TODO_AUDIO_ID',
  radio: 'TODO_RADIO_ID',

  /** Podcast con capítulos */
  podcast: 'TODO_PODCAST_ID',

  /** VOD con subtítulos en múltiples idiomas */
  vodWithSubtitles: 'TODO_VOD_SUBTITLES_ID',

  /** VOD con múltiples audio tracks */
  vodMultiAudio: 'TODO_VOD_MULTI_AUDIO_ID',

  /** VOD con ads habilitados en la configuración de la plataforma */
  vodWithAds: 'TODO_VOD_WITH_ADS_ID',
} as const

// ── Streams externos (fallback para tests de integración pura) ────────────
//
// Usados cuando el test valida comportamiento del stream (ABR, buffer, etc.)
// sin necesidad de la plataforma Mediastream.
// Pasados como `src` en InitConfig — puede requerir que el player los acepte.

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

// ── Alias para compatibilidad con tests existentes ────────────────────────
// Mientras se obtienen los IDs reales, los tests de stream puro usan ExternalStreams.
export const Streams = ExternalStreams

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
