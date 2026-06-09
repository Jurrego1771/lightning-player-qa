# platform-config — Overview

## Qué hace

`platform-config` es el módulo de **bootstrap de configuración** del Lightning Player. Antes de que cualquier
otro subsistema (playback, HLS, DASH, DRM, ads, subtitles, analytics) pueda inicializar, este módulo hace **fetch
HTTP a la Plataforma Mediastream** para resolver dos documentos JSON:

1. **Player config** — `GET {protocol}://{embedHost}/{configType}/{id}/player/{playerId}` (lo dispara `api.js`,
   no `loadConfig.js`). Determina el *view type* (`video` / `audio` / `radio` / `compact`), la UI, colores,
   `autoplay`, `volume`, `renderAs` y settings de federación.
2. **Content config** — `GET {protocol}://{embedHost}/{video|audio|live-stream|episode}/{id}.json?...` (lo hace
   `loadConfig.js`). Resuelve las URLs de manifest (`src.hls`, `src.mpd`, `src.mp4`, `src.m4a`, `src.mp3`), la
   config de DRM, la config de ads (incluyendo Google DAI y MediaTailor DAI), subtítulos, metadata, DVR y resume.

`loadConfig()` no solo hace el fetch: **normaliza y transforma** la respuesta cruda de la plataforma en un objeto
`config` listo para montar el player. Esa transformación incluye:

- Selección de source por prioridad (HLS / DASH / MP4 / M4A / MP3) según `renderAs`, `player.type` y `format`.
- Detección de requerimiento DRM (`responseDrm.enabled` o cualquier sub-config con `serverURL`) → produce
  `drm._candidateUrls` con HLS y MPD decoradas, y fuerza `hlsVariant: 'normal'`.
- Construcción de DAI: `ad_insertion_google` → `ads.googleDAI`; `ad_insertion` → `ads.mediaTailorDAI`.
- Decoración de URL con query params de tracking (`uid`/`sid`/`pid`/`c`/`ds`/`ref`/`res`/`an`/`at`/`av`),
  cache-busting (`_=Date.now()`), tokens (`access_token`, `admin_token`), AdsWizz edge (`es`/`pz`).
- Reescritura de manifest para DVR de audio (`live.m3u8` → `playlist_dvr_range-{start}-{duration}.m3u8`).
- Resume position desde localStorage (`resumePlaying.js`) cuando `resumePosition` está activo.

Si el fetch falla (red, 4xx, 5xx, JSON inválido), `loadConfig()` lanza `PlayerInitError(..., fatal=true)`, que
`api.js` captura y reemite como evento público `error` con `{ fatal: true }`. **No hay fallback de contenido**:
sin config válida, ningún player inicializa.

## Archivos clave

| Archivo | Rol |
|---------|-----|
| `src/platform/loadConfig.js` | Fetch del content config, normalización completa, detección DRM/DAI, selección de source. Fuente de verdad técnica del módulo. |
| `src/platform/resumePlaying.js` | Persistencia de posición de reproducción en `localStorage` (TTL 1h). Alimenta `startPos`. |
| `src/platform/share.js` | Construcción de URLs de share cards (LIVE / MOMENT / SONG / EPISODE). Periférico al config core. |
| `src/api/api.js` | Dispara el fetch del **player config** y orquesta `loadConfig()`. Captura `PlayerInitError` → evento `error`. |
| `src/helper/request.js` | Wrapper axios. `GET(url, { withCredentials: true })`. |
| `constants.cjs` | `embedHost` (default `develop.mdstrm.com`, override `EMBED_HOST`) y `protocol`. |

## Flujo de datos

```
                 api.js init
                     │
   1. player config  │  GET /{type}/{id}/player/{playerId}?_=ts
      ───────────────┤  → { name, view:{type,style}, autoplay, volume, renderAs }
                     │
   2. loadConfig()   │  GET /{video|audio|live-stream|episode}/{id}.json?validate=true&metadata=true&...
      ───────────────┤  → respuesta cruda de plataforma
                     │
      normalización  ▼
        ┌─────────────────────────────────────────────────────────┐
        │ • source select (hls/mpd/mp4/m4a/mp3)                     │
        │ • DRM detect → drm._candidateUrls + hlsVariant=normal     │
        │ • ad_insertion_google → ads.googleDAI                     │
        │ • ad_insertion → ads.mediaTailorDAI                       │
        │ • URL decorate (tracking, tokens, cache-bust, adswizz)    │
        │ • DVR rewrite, resume startPos                            │
        └─────────────────────────────────────────────────────────┘
                     │
                     ▼  config normalizado
   3. new LightningPlayer(container, config, _loadConfig)
                     │
        ┌────────────┴────────────────────────────────┐
        ▼            ▼            ▼          ▼          ▼
     playback      hls/dash      drm     ads-manager  subtitles / youbora

   Error path: fetch falla → PlayerInitError(fatal:true) → api.js → evento `error`
```

## API pública

`platform-config` no expone API directa al integrador. Su superficie pública es:

- **Indirecta vía atributos del embed** que `api.js` mapea a opciones de `loadConfig()`:
  `data-type` (`media`/`episode`/`live`/`dvr`), `data-id`, `data-player`, `data-access-token`,
  `data-format` (`hls`/`dash`/`mpd`), `data-resume-position`, `data-without-cookies`, `data-no-ad`,
  `data-render-as`, `data-next-episode-id`, `data-next-episode-time`, `data-dnt`.
- **Evento público emitido (vía `api.js`)**: `error` con payload `{ fatal: true, message, data, status, metadata }`
  cuando la resolución del config falla.

## Interacciones con otros sistemas

| Sistema | Interacción relevante para QA |
|---------|-------------------------------|
| `api-bootstrap` (`api.js`) | Consumidor directo. Dispara player config y captura errores de `loadConfig`. |
| `playback-core` | Recibe `src`, `startPos`, `selectedSrcType`, `preloadEnabled`. |
| `hls` / `dash` | `useDash` y `selectedSrcType` deciden el handler. `hlsVariant: 'normal'` forzado en DRM/DAI/subtítulos. |
| `drm` | `drm._candidateUrls` (HLS+MPD decoradas) y `drm.enabled`. Cuando hay DRM, `src` se pone `null` y el plugin DRM elige formato vía `getDRMSupport`. |
| `ads-manager` | `ads`, `ads.map` (normalizado desde `adsMap`), `ads.googleDAI`, `ads.mediaTailorDAI`. |
| `ads-dai` / `ads-sgai` | `ad_insertion_google` y `ad_insertion` del backend pasan por aquí. |
| `subtitles` | `subtitles[]`; se eliminan cuando hay Google DAI (DAI reescribe subtítulos por los gaps de ads). |
| `youbora` | Consume `account`, `mediaId`, metadata del config resuelto. |
| AdsWizz | `adswizz_companion.edge_data`/`afrUrl` cargan el SDK AdsWizz y decoran la URL. |
