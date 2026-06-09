# Youbora (NPAW) — Overview

## Qué hace

El módulo Youbora integra el SDK de analítica de video **NPAW (Nice People At Work)** —comercialmente conocido como **Youbora**— en Lightning Player. Reporta métricas de **QoE (Quality of Experience)** y **QoS (Quality of Service)** a la NPAW Suite mediante "beacons" HTTP enviados a los collectors de NPAW (NQS — Nice Quality System).

A nivel de usuario final no hay UI: es un tracker silencioso que abre una "View" (sesión de tracking) cuando el contenido empieza a reproducirse y la cierra cuando termina, reportando en el camino:

- **Join time** (tiempo desde play hasta el primer frame) → `/joinTime`
- **Rebuffering** (buffer underruns durante la reproducción) → `/bufferUnderrun`
- **Bitrate / rendition** (resolución@bitrate activo) → `entities` en `/ping`
- **Errores** fatales y no-fatales → `/error`
- **Pausa/resume, seek, ended** → `/pause`, `/resume`, `/seek`, `/stop`
- **CDN / media resource** (URL real del stream) → `mediaResource` en `/start`
- **Heartbeats** periódicos cada ~5s → `/ping`
- **Métricas de ads** en un adapter separado → `/adBreakStart`, `/adInit`, `/adStart`, `/adJoin`, quartiles, `/adStop`, `/adBreakStop`

El tracker es un **adapter** que traduce eventos internos del player (Lightning) al vocabulario de eventos del SDK NPAW. Hay dos adapters: uno de **contenido** (`registerDefaultAdapter`) y uno de **ads** (`registerDefaultAdsAdapter`).

## Archivos clave

| Archivo | Rol |
|---------|-----|
| `src/analytics/youbora/index.jsx` | Componente plugin (`Base.wrap`). `contextMapper` extrae `account_code`, `appName`, `customer_extras.*`. Decide restart vs updateOptions en cambio de contenido. |
| `src/analytics/youbora/tracker.js` | `YouboraTracker`: instancia `NpawPlugin`, registra adapters, hace bind de eventos internos→fire* del SDK, maneja sesión, ad break, errores. Fuente de verdad técnica. |
| `src/plugins/index.js` | Loader de plugins. Activa `YouboraTracker` solo si `options.metadata.player.tracking.youbora.enabled` es truthy. |
| `constants.cjs` | Define `Events._*` e `InternalEvents._*` que el tracker escucha (`_contentFirstPlay`, `_playing`, `_pause`, `_ended`, `_seeking`, `_seeked`, `_buffering`, `_canplay`, `_adsContentPauseRequested`, `_adsContentResumeRequested`, `_error`, y la familia `_ads*`). |
| `npaw-plugin@^7.3.28` | SDK externo. `pluginVersion` observado en prod: `7.3.28-generic-js`. |

## Flujo de datos

```
Player config (plataforma)
   options.metadata.player.tracking.youbora = { enabled, account_code }
        │
        ▼
src/plugins/index.js  load()  ── isYouboraEnabled? ──► monta <YouboraTracker/> (lazy)
        │ (NO si dnt=1, reels, o fatal error)
        ▼
index.jsx componentDidMount → tracker.init(options)
        │  contextMapper → { id, type, title, accountCode, appName, userType, userName, metadata }
        ▼
tracker.init()  ── if (!accountCode) return ──►  (sin beacons, no-op)
        │
        ▼  new NpawPlugin(accountCode, {...})
   registerDefaultAdsAdapter()        registerDefaultAdapter() [diferido a _initAdapter]
        │                                   │
   _bindAdsEvents()                    _bindContentEvents(api)
        │                                   │
   internalEmitter.on(Events._ads*)    internalEmitter.on(Events._contentFirstPlay, _playing, ...)
        │                                   │
        ▼                                   ▼
   Eventos del player ──────────────► handlers ──► adapter.fire*() / adsAdapter.fire*()
                                              │
                                              ▼
                                    NpawPlugin → XHR/beacon
                                       lma.npaw.com (handshake /data, /configuration)
                                       {accountCode}.youboranqs01.com (beacons NQS)
```

**Secuencia de sesión de contenido (happy path VOD):**
`ready` → `_initAdapter()` + `fireInit()` → `contentFirstPlay` → `fireStart()` + `fireJoin()` (`_started=true`) → `/ping` cada ~5s → `pause`→`firePause`, `playing`→`fireResume`, `seeking/seeked`→`fireSeekBegin/End`, `buffering/canplay`→`fireBufferBegin/End` → `ended` → `fireStop()` (`_started=false`).

**Secuencia de ad break (pre-roll):**
`adsContentPauseRequested` → `_inAdBreak=true` (si no había sesión, abre View de contenido y `firePause` para que los pings tengan playhead) → `adsStarted` → `fireBreakStart` + (microtask) `fireStart`/`fireJoin` del ad adapter → quartiles → `adsComplete`→`fireStop` → `adsAllAdsCompleted`→`fireBreakStop` → `adsContentResumeRequested` → `_inAdBreak=false`, `fireResume` del contenido.

## API pública

Este módulo **no expone API pública** en el objeto player. Se configura íntegramente vía player config de plataforma:

```
metadata.player.tracking.youbora = {
  enabled: true,            // truthy: 1 | '1' | true | 'true'
  account_code: "<string>"  // requerido; sin él init() es no-op
}
```

Metadata de usuario opcional (issue-706), leída por `contextMapper` desde el root de `options`:
- `customer_extras.type` → `user.type` (userType)
- `customer_extras.name` → `user.name` (userName)

**Única señal observable para QA:** los beacons HTTP a `*.youboranqs01.com` y `*.youbora.com` (interceptables con `page.route`). No hay getter en el player para leer el estado de Youbora.

## Interacciones con otros sistemas

- **events** — escucha el `internalEmitter` y la taxonomía `Events`/`InternalEvents`. Renombres de estos eventos rompen el tracker silenciosamente.
- **playback-core** — depende del objeto `api` (vía `get('api')`) para `currentTime`, `duration`, `src`, `videoWidth/Height`, `bitrate`, `playbackRate`, `volume`, `fullscreen`. La métrica de bitrate/rendition depende de que el handler (HLS/DASH) los exponga.
- **ads-manager / ads-ima** — los eventos `Events._ads*` alimentan el ad adapter. La separación content/ads depende del guard `_inAdBreak`.
- **platform-config** — `enabled` y `account_code` provienen del player config servido por la plataforma.
- **metadata** — `metadata.show` / `metadata.season` enriquecen las Views de episodios.
- **quality-selector** — los cambios de rendition manuales/automáticos se reflejan vía `getRendition()` en pings.
