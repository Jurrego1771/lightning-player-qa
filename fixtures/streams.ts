/**
 * streams.ts — Catálogo de contenido de test
 *
 * IDs leídos de variables de entorno (CONTENT_ID_*) con fallback a los IDs DEV.
 * Para cambiar un ID: definir la variable en .env o en CI secrets.
 *
 * Contenido que requiere access token (live/dvr): usar el fixture `contentAccess`
 * en lugar de pasar el token manualmente.
 */

export const ContentIds = {
  /** VOD de video — contenido corto (~2 min) para tests rápidos */
  vodShort: process.env.CONTENT_ID_VOD_SHORT || '69d2f1e0461dd502cd921ad6',

  /** VOD de video — contenido largo (>10 min) para tests de ABR y buffer */
  vodLong: process.env.CONTENT_ID_VOD_LONG || '6900ffde6ddf33fd39a523ee',

  /** Stream en vivo activo — requiere accessToken (ver fixture contentAccess) */
  live: process.env.CONTENT_ID_LIVE || '6a15a4e5a23b8b92586beb63',

  /**
   * Stream DVR activo — mismo ID que live, mismo accessToken.
   * Pasarlo como type: 'dvr' en goto().
   */
  dvr: process.env.CONTENT_ID_DVR || '6a15a4e5a23b8b92586beb63',

  /** Audio */
  audio: process.env.CONTENT_ID_AUDIO || '698b4a88d9cc56fe7a404079',

  /** Radio — stream live de audio con metadata nowplaying */
  radio: process.env.CONTENT_ID_RADIO || '69724db4002efe954a6c0e00',

  /**
   * Podcast — pendiente confirmar ID.
   * Tests se saltean si el valor empieza con TODO_.
   */
  podcast: process.env.CONTENT_ID_PODCAST || 'TODO_PODCAST_ID',

  /** VOD con subtítulos en múltiples idiomas */
  vodWithSubtitles: process.env.CONTENT_ID_VOD_WITH_SUBTITLES || '69d3081d5493800312af8b6e',

  /**
   * VOD con múltiples audio tracks — pendiente confirmar ID.
   * Tests se saltean si el valor empieza con TODO_.
   */
  vodMultiAudio: process.env.CONTENT_ID_VOD_MULTI_AUDIO || 'TODO_VOD_MULTI_AUDIO_ID',

  /** VOD con ads: pre-roll + mid-roll a los 10s + post-roll (VMAP Mediastream) */
  vodWithAds: process.env.CONTENT_ID_VOD_WITH_ADS || '6900fffb6ddf33fd39a5288e',

  /** VOD con Google IMA VMAP: pre-roll + mid-roll (cue=15s) + post-roll vía pubads.g.doubleclick.net */
  vodWithImaAds: process.env.CONTENT_ID_VOD_WITH_IMA_ADS || '6a1448a663e206efb1ae2ded',

  /**
   * VOD con overlay ad (nonlinear IMA) cuyo VAST URL contiene $custom.tag_custom$.
   * Fixture para verificar que el player resuelve macros en el flujo overlay (PR #725).
   * Requiere haber ejecutado: npx ts-node scripts/setup-overlay-ad-fixture.ts
   */
  vodWithOverlayMacroAds: process.env.CONTENT_ID_VOD_WITH_OVERLAY_MACRO_ADS || '6a36f0857896eb99d5beffc9',

  /**
   * VOD largo (195s) con overlay ad nonlinear IMA configurado en la plataforma dev.
   * overlayPosition=0 → el overlay aparece inmediatamente al inicio de la reproducción.
   * Confirmado via MCP QA: VAST request sz=480x70 → HTTP 200, video continúa playing.
   * Usar para tests de comportamiento del overlay (no de resolución de macros).
   */
  vodWithOverlay: process.env.CONTENT_ID_VOD_WITH_OVERLAY || '6a3946726e0d2c90d67907a9',

  /**
   * Episodio VOD con "siguiente episodio" configurado en la plataforma.
   * Cuando el contenido llega a nextEpisodeTime, el player emite nextEpisodeIncoming.
   * Tests se saltean si el valor empieza con TODO_.
   */
  episodeWithNext: process.env.CONTENT_ID_EPISODE_WITH_NEXT || 'TODO_EPISODE_WITH_NEXT_ID',

  /** VOD DASH — stream VOD con manifiesto MPD (type: 'media') */
  dashVod: process.env.CONTENT_ID_DASH_VOD || '6a1448a663e206efb1ae2ded',

  /** Live DASH — stream live con manifiesto MPD (type: 'live') */
  dashLive: process.env.CONTENT_ID_DASH_LIVE || '6a0f2956a2a6f91404c3cc0c',

  /**
   * DVR DASH — stream DVR sobre DASH (type: 'dvr').
   * duration tarda en popularse después de 'playing' — tests usan expect.poll().
   * Seek tests skipados en webkit (DASH DVR inestable en Playwright WebKit).
   */
  dashDvr: process.env.CONTENT_ID_DASH_DVR || '6a0f2956a2a6f91404c3cc0c',
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

// ── Player IDs para tests de analytics ───────────────────────────────────
//
// Player configs en la plataforma que tienen tracking (Youbora, etc.) configurado.
// Usar con fixture `player` (sin mock) para tests de analytics con contenido real.

export const PlayerIds = {
  /** Player con Youbora habilitado — usar con ContentIds.episodeWithNext para tests de sesión */
  youboraTest: process.env.PLAYER_ID_YOUBORA_TEST || '69f11623472377eda39c266e',
} as const

export const MockContentIds = {
  vod: 'mock-vod-1',
  live: 'mock-live-1',
  audio: 'mock-audio-1',
  episode: 'mock-episode-1',
  podcast: 'mock-podcast-1',
  dashVod: 'mock-dash-vod-1',
  vodWithAdMarkers: 'mock-vod-admarkers-1',
  /** VOD con metadata.preview.vtt para tests del componente WebVTTPreview (PR #707) */
  vodWithVttPreview: 'mock-vtt-preview-1',
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
    withDiscontinuity: 'http://localhost:9001/vod-with-discontinuity/index.m3u8',
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
