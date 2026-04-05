/**
 * streams.ts — Catálogo de streams de test controlados
 *
 * REGLA: Nunca usar streams de producción en tests automatizados.
 * Todos los streams deben ser deterministas y disponibles 24/7.
 *
 * Fuentes utilizadas:
 * - Bitmovin public test streams (HLS/DASH, múltiples calidades)
 * - Axinom public test vectors (DRM: Widevine, PlayReady, FairPlay)
 * - Eyevinn web-player demo streams (Live simulado)
 */

export const Streams = {
  // ── VOD HLS ────────────────────────────────────────────────────────────
  hls: {
    /** HLS VOD multi-calidad (Bitmovin) — confiable, sin DRM */
    vod: 'https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8',

    /** HLS VOD con subtítulos WebVTT */
    vodWithSubtitles: 'https://bitdash-a.akamaihd.net/content/MI201109210084_mpeg-4_hd_ready/m3u8s/f08e80da-bf1d-4e3d-8899-f0f6155f6efa.m3u8',

    /** HLS con múltiples audio tracks */
    vodMultiAudio: 'https://playertest.longtailvideo.com/adaptive/elephants_dream_v4/index.m3u8',

    /** HLS VOD corto (~30s) para tests rápidos */
    vodShort: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',

    /** HLS Live simulado (stream que siempre está activo — Mux) */
    live: 'https://test-streams.mux.dev/tos_ismc/master.m3u8',
  },

  // ── VOD DASH ───────────────────────────────────────────────────────────
  dash: {
    /** DASH VOD multi-calidad (Bitmovin) */
    vod: 'https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd',

    /** DASH VOD con subtítulos TTML */
    vodWithSubtitles: 'https://livesim.dashif.org/dash/vod/testpic_2s/multi_subs.mpd',

    /** DASH Live (DASH-IF live sim) */
    live: 'https://livesim.dashif.org/dash/vod/testpic_2s/multi_subs.mpd',
  },

  // ── DRM (Axinom Public Test Vectors) ───────────────────────────────────
  // Source: https://github.com/Axinom/public-test-vectors
  drm: {
    /** DASH + Widevine + PlayReady (multi-key) */
    dashMultiKey: {
      src: 'https://media.axprod.net/TestVectors/v7-MultiDRM-SingleKey/Manifest.mpd',
      widevine: {
        licenseUrl: 'https://drm-widevine-licensing.axtest.net/AcquireLicense',
        headers: { 'X-AxDRM-Message': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ2ZXJzaW9uIjoxLCJjb21fa2V5X2lkIjoiYjMzNjRlYjUtNTFmNi00YWUzLThjOTgtMzNjZWQ1ZTM1YjY5IiwibWVzc2FnZSI6eyJ0eXBlIjoiZW50aXRsZW1lbnRfbWVzc2FnZSIsImtleXMiOlt7ImlkIjoiOWViNDA1MGQtZTQ0Yi00ODAyLTkzMmUtMjdkNzUwODNlMjY2IiwiZW5jcnlwdGVkX2tleSI6ImxLM09qSExZVzI0Y3Iya3RSNzRmbnc9PSJ9XX19.4luyXfRKSA' },
      },
    },

    /** DASH + Widevine simple key (para tests básicos de DRM) */
    dashSingleKey: {
      src: 'https://storage.googleapis.com/wvmedia/cbc/h264/tears_of_steel/tears_of_steel.mpd',
      widevine: { licenseUrl: 'https://proxy.uat.widevine.com/proxy?provider=widevine_test&video_id=2015_tears' },
    },
  },

  // ── Audio Only ──────────────────────────────────────────────────────────
  audio: {
    /** MP3 directo */
    mp3: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',

    /** HLS Audio only */
    hlsAudio: 'https://playertest.longtailvideo.com/adaptive/oceans-aes/oceans-aes.m3u8',
  },
} as const

// ── Configuraciones de Red (para simular condiciones) ─────────────────────

export const NetworkProfiles = {
  /** Broadband normal */
  broadband: {
    downloadThroughput: (25 * 1024 * 1024) / 8, // 25 Mbps
    uploadThroughput: (10 * 1024 * 1024) / 8,
    latency: 5,
  },
  /** 4G móvil */
  mobile4G: {
    downloadThroughput: (20 * 1024 * 1024) / 8, // 20 Mbps
    uploadThroughput: (10 * 1024 * 1024) / 8,
    latency: 30,
  },
  /** 3G degradado — fuerza calidad baja en ABR */
  degraded3G: {
    downloadThroughput: (500 * 1024) / 8, // 500 Kbps
    uploadThroughput: (250 * 1024) / 8,
    latency: 100,
  },
  /** Conexión casi offline — para tests de error recovery */
  almostOffline: {
    downloadThroughput: (50 * 1024) / 8, // 50 Kbps
    uploadThroughput: (20 * 1024) / 8,
    latency: 500,
  },
} as const
