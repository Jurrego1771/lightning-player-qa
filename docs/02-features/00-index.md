# Lightning Player — Feature Index

> Inventario completo de funcionalidades, handlers, integraciones y API pública.
> Generado desde el estado actual del repo. Usar `/document-feature <nombre>` para doc detallada de cada feature.

---

## Playback Handlers

| Feature               | Archivos                                          | Descripción                                                          |
| --------------------- | ------------------------------------------------- | -------------------------------------------------------------------- |
| **HLS Handler**       | `src/player/handler/hls/`                         | HLS.js completo + variantes light y beta; también soporta HLS nativo |
| **DASH Handler**      | `src/player/handler/dash/`                        | DASH/MPEG-DASH vía dash.js + System73 SDK                            |
| **Native Handler**    | `src/player/handler/native.js`                    | HTML5 nativo `<video>`/`<audio>` con text tracks                     |
| **Audio Track Proxy** | `src/player/handler/utils/audioTrackListProxy.js` | Proxy para manejo de audio tracks                                    |

---

## DRM

| Feature | Archivos | Descripción |
|---------|----------|-------------|
| **DRM Plugin** | `src/player/drm/plugin.jsx` | Resolución de URLs candidatas; soporta FairPlay, Widevine, PlayReady |
| **DRM Support Detection** | `src/helper/getDRMSupport.js` | Detecta capacidades DRM del dispositivo |
| **DASH Protection** | `src/player/drm/getDashProtectionData.js` | Configura protection data para dash.js |

---

## Sistemas de Publicidad (Ads)

### Ad Manager (core interno)

| Feature | Archivos | Descripción |
|---------|----------|-------------|
| **Ad Manager** | `src/ads/manager/` | Orquestación central: VAST/VMAP, breaks, creatives, click overlays, skip |
| **VAST Loader** | `src/ads/manager/loader/vast.js` | Parseo de manifiestos VAST |
| **VMAP Loader** | `src/ads/manager/loader/vmap.js` | Parseo de manifiestos VMAP |
| **OMID Tracker** | `src/ads/manager/tracker/omid/` | Tracking viewability Open Measurement |
| **Ad Render** | `src/ads/manager/render/` | Renderizado de anuncios al contenedor |
| **Ad Container** | `src/ads/manager/container/` | UI y settings del área de ads |

### Google IMA

| Feature | Archivos | Descripción |
|---------|----------|-------------|
| **Google IMA** | `src/ads/googleIma/` | SDK Google IMA: ads lineales, no-lineales y companion |
| **IMA Handler** | `src/ads/googleIma/handler.js` | Ciclo de vida del SDK IMA |
| **IMA Overlay** | `src/ads/googleIma/overlayAds.jsx` | Componente React para overlay ads |

### Google DAI

| Feature | Archivos | Descripción |
|---------|----------|-------------|
| **Google DAI** | `src/ads/googleDAI/plugin.jsx` | Dynamic Ad Insertion para live y VOD (HLS/DASH) |
| **DAI Render** | `src/ads/googleDAI/render.jsx` | Renderizado específico DAI |

### Google SGAI

| Feature | Archivos | Descripción |
|---------|----------|-------------|
| **Google SGAI** | `src/ads/googleSGAI/plugin.jsx` | Server-Side Ad Insertion avanzado |
| **SGAI Services** | `src/ads/googleSGAI/services/` | Ad break, playback control, HLS loader, manifest parsing, audio service, fragment tracking |
| **SGAI Hooks** | `src/ads/googleSGAI/hooks/` | React hooks para lifecycle SGAI |

### Otros sistemas de ads

| Feature | Archivos | Descripción |
|---------|----------|-------------|
| **AdSwizz** | `src/ads/adswizz/` | Ads para radio/podcast con SDK AdSwizz |
| **AWS MediaTailor DAI** | `src/ads/mediaTailorDAI/` | DAI backend AWS MediaTailor |
| **In-The-Game (ITG)** | `src/ads/itg/` | Overlays interactivos ITG con hooks de control |
| **Google Publisher Tag** | `src/ads/googletag.jsx` | Google Ad Manager via GPT |
| **Ad Blocker Detection** | `src/ads/detectAdblocker.jsx` | Detecta si el usuario tiene ad blocker |

---

## Analytics

| Feature | Archivos | Descripción |
|---------|----------|-------------|
| **Stream Metrics** | `src/analytics/streammetrics/` | Analytics interno Mediastream |
| **Youbora (NPAW)** | `src/analytics/youbora/` | NPAW Youbora player analytics |
| **Comscore** | `src/analytics/comscore/` | Comscore StreamSense analytics |
| **Google Analytics 4** | `src/analytics/googletracker.jsx` | GA4 vía react-ga4 |
| **Live Reactions** | `src/analytics/reactions/` | Reacciones en vivo vía Firebase: scheduling, validación, transport |
| **Konodrac** | `src/analytics/konodrac/` | Konodrac Mark Collector API — pixel tracking para CARTV OTT |
| **Analytics Tracker** | `src/analytics/tracker.jsx` | Coordinador principal de todos los plugins de analytics |

---

## Vistas (UI Views)

| Vista | Archivos | Descripción |
|-------|----------|-------------|
| **Video** | `src/view/video/` | Player full-featured con controls, chapters, DVR, CC, quiz, reactions |
| **Compact** | `src/view/compact/` | UI compacta/minimalista |
| **Podcast** | `src/view/podcast/` | UI podcast con metadata del show |
| **Podcast 2** | `src/view/podcast2/` | Diseño alternativo de podcast |
| **Radio** | `src/view/radio/` | Player radio sin contenedor de video |
| **Radio SA** | `src/view/radioSA/` | Radio player versión Sudamérica |
| **Reels** | `src/view/reels/` | UI estilo TikTok para short-form video |
| **None** | `src/view/none/` | Modo headless — sin UI |

---

## Controles del Player (Video View)

| Control | Archivos | Descripción |
|---------|----------|-------------|
| **Play/Pause** | `src/view/video/components/controls/` | Botones play y pause |
| **Volume** | `.../controls/volume/` | Slider y toggle mute |
| **Seek/Progress Slider** | `.../controls/seekSlider/` | Scrubbing y visualización de progreso |
| **Playback Speed** | `.../controls/speed/` | Ajuste de velocidad (0.5x–2x) |
| **Quality Selector** | `.../controls/options/` | Selección de bitrate/nivel HLS-DASH |
| **Closed Captions** | `.../controls/closedCaption/` | Selección de pistas de subtítulos |
| **Chapters** | `.../controls/chapters/` | Navegación y jump-to por capítulos |
| **Text Search** | `.../controls/textSearch/` | Búsqueda de texto en video con navegación de resultados |
| **DVR/Live Indicator** | `.../controls/dvrLiveIndicator/` | Indicador live y seek-back DVR |
| **Ellipsis Menu** | `.../controls/ellipsis/` | Menú overflow con opciones adicionales |
| **Records** | `.../controls/records/` | Episodios/transmisiones grabadas |
| **Play Anywhere** | `.../controls/playAnywhere/` | Control de reproducción cross-device |
| **Custom Icons** | `.../controls/customIcons/` | Iconos de controles personalizables |

---

## Overlays y Componentes de UI

| Componente | Archivos | Descripción |
|------------|----------|-------------|
| **Video Container** | `.../components/container/` | Wrapper del `<video>` con subtítulos y buffering |
| **Header** | `.../components/header/` | Overlay superior: título, metadata, botón back |
| **Watermark** | `.../components/watermark/` | Logo/watermark overlay |
| **Info Panel** | `.../components/info/` | Panel de metadata del contenido |
| **Next Episode** | `.../components/nextEpisode/` | UI auto-play siguiente episodio con countdown |
| **Pause Info** | `.../components/pauseInfo/` | Info mostrada al pausar |
| **Post Content** | `.../components/post/` | Post-playback: recomendaciones, créditos |
| **Quiz** | `.../components/quiz/` | Overlay de quiz interactivo durante reproducción |
| **Reactions** | `.../components/reactions/` | Picker de emojis/emotes para reacciones en vivo |
| **Share** | `.../components/share/` | Panel de opciones para compartir en redes |
| **Feedback** | `.../components/feedback/` | UI para feedback y reporte de bugs |
| **Casting (Chromecast)** | `.../components/casting/` | Selección y control de dispositivos Chromecast |
| **Toast Notifications** | `.../components/toast/` | Notificaciones pequeñas (alertas de bandwidth, etc.) |
| **Bandwidth Alert** | `.../components/bandwidthAlert/` | Advertencia de bajo ancho de banda |
| **Skin/Theme** | `.../components/skin/` | Soporte de temas con variante TV skin |
| **Fullscreen** | Integrado en controls | Toggle fullscreen |
| **Picture-in-Picture** | Integrado en controls | Toggle PiP |
| **Fatal Error** | `.../components/fatalErrorMessage/` | UI de estado de error crítico |

---

## Chromecast

| Feature | Archivos | Descripción |
|---------|----------|-------------|
| **Cast Manager** | `src/chromecast/CastManager.js` | Descubrimiento, conexión y casting de media |
| **Media Builder** | `src/chromecast/MediaBuilder.js` | Construye mensajes de media para Chromecast |
| **Cast Subtitles** | `src/chromecast/subtitles.js` | Conversión de text tracks para Chromecast |
| **Cast Loader** | `src/chromecast/loader.js` | Carga el SDK de Google Cast |

---

## Plataforma e Integración Mediastream

| Feature | Archivos | Descripción |
|---------|----------|-------------|
| **Config Loader** | `src/platform/loadConfig.js` | Carga config desde API Mediastream: template, asset, ads, DRM, quality levels |
| **Resume Playing** | `src/platform/resumePlaying.js` | Guarda/carga posición para "continuar viendo" |
| **Share Platform** | `src/platform/share.js` | Integración con sistema de share de la plataforma |
| **Federation SDK** | `src/federation/` | Autenticación de usuario y features cross-platform |

---

## Metadata & Media Session

| Feature | Archivos | Descripción |
|---------|----------|-------------|
| **Playing Metadata** | `src/metadata/playingMetadata.js` | Metadata now-playing para Media Sessions API |
| **Media Session API** | `src/metadata/mediaSession.js` | Controles de lock screen y notificaciones |
| **Firebase** | `src/metadata/firebase.js` | Init Firebase y sync de metadata |
| **Firestore** | `src/metadata/firestore/` | Integración Firestore para metadata |

---

## API Pública — Métodos

| Método | Retorna | Descripción |
|--------|---------|-------------|
| `play()` | Promise | Inicia reproducción |
| `pause()` | Promise | Pausa reproducción |
| `on(event, cb)` | Fn unsubscribe | Suscribirse a eventos |
| `once(event, cb)` | Fn unsubscribe | Suscribirse una vez |
| `off(event, cb)` | void | Desuscribirse |
| `addEventListener(event, cb)` | Fn unsubscribe | API DOM estándar |
| `removeEventListener(event, cb)` | void | API DOM estándar |
| `getOption(key)` | any | Obtener opción específica |
| `getOptions()` | object | Obtener todas las opciones |
| `setOption(key, val)` | void | Setear opción |
| `setOptions(obj)` | void | Setear múltiples opciones |
| `set(prop, val)` | any | Setear propiedad del player |
| `get(prop)` | any | Obtener propiedad del player |
| `loadContent(options)` | Promise | Cargar nuevo contenido |
| `destroy()` | void | Cleanup y remover player |
| `addOverride(obj)` | void | Agregar override de control de reproducción |
| `removeOverride(obj)` | void | Remover override |

---

## API Pública — Propiedades

| Propiedad | Tipo | Descripción |
|-----------|------|-------------|
| `version` | string | Versión del player |
| `currentTime` | number (get/set) | Posición actual en segundos |
| `paused` | boolean (readonly) | Si la reproducción está pausada |
| `status` | string (readonly) | Estado actual: play, pause, error, etc. |
| `isPlayingAd` | boolean (readonly) | Si está reproduciendo un anuncio |
| `duration` | number (readonly) | Duración total del contenido |
| `volume` | number (get/set) | Volumen 0–1 |
| `playbackRate` | number (get/set) | Velocidad de reproducción |
| `buffered` | TimeRanges | Rangos buffereados |
| `level` | number (get/set) | Nivel de calidad actual |
| `levels` | array (readonly) | Niveles de calidad disponibles |
| `nextLevel` | number (get/set) | Próximo nivel de calidad |
| `autoLevelEnabled` | boolean (get/set) | Auto switching de calidad |
| `fps` | number (readonly) | Frames por segundo actuales |
| `bandwidth` | number (readonly) | Ancho de banda en bps |
| `bitrate` | number (readonly) | Bitrate actual en bps |
| `droppedFrames` | number (readonly) | Frames caídos |
| `textTracks` | TextTrackList (readonly) | Pistas de texto disponibles |
| `onNext` | function (get/set) | Callback siguiente episodio |
| `onPrev` | function (get/set) | Callback episodio anterior |
| `error` | Error (readonly) | Error actual si existe |
| `src` | string (readonly) | Fuente de media actual |

---

## API Pública — Eventos

### Reproducción
`loaded` · `ready` · `play` · `pause` · `playing` · `seeking` · `seeked` · `timeupdate` · `ended` · `waiting` · `buffering` · `durationchange` · `ratechange` · `volumechange` · `abort` · `stalled` · `suspend` · `emptied` · `canplay` · `canplaythrough` · `loadstart` · `loadedmetadata` · `loadeddata` · `progress`

### Contenido
`sourcechange` · `metadataloading` · `metadataloaded` · `metadatachanged` · `contentFirstPlay` · `tabchange` · `tabitemchange` · `tabitemschange` · `programdatetime`

### Calidad y Tracks
`levelchange` · `levelchanged` · `texttrackchange` · `texttrackaddtrack` · `texttrackremovetrack` · `audiotrackchange` · `audiotrackaddtrack` · `audiotrackremovetrack`

### Interacción de usuario
`share` · `playlistchange` · `quizAnswered` · `reactionEmitted` · `nextEpisodeIncoming` · `nextEpisodeConfirmed` · `enterpictureinpicture` · `leavepictureinpicture` · `fullscreenchange` · `dismissButton`

### Ads (40+ eventos)
`adsStarted` · `adsComplete` · `adsSkipped` · `adsClick` · `adsFirstQuartile` · `adsMidpoint` · `adsThirdQuartile` · `adsImpression` · `adsViewableImpression` · `adsContentPauseRequested` · `adsContentResumeRequested` · `adsLinearChanged` · `adsSkippableStateChanged` · `adsError` · `adsAdBuffering` · `adsAdCanPlay` · `adsAdProgress` · `adsVolumeChanged` · `adsVolumeMuted` · `adsUserClose` · `adsRequested` · `adsLoaded` · `adsAdBreakReady` · `adsTimeUpdate` · `adsLog` · `adblockerDetected`

### Casting
`castStateChange` · `castConnected` · `castDisconnected` · `castError` · `castMediaLoaded` · `castMediaEnded` · `castTracksLoaded` · `castActiveTracksChanged`

### Sistema
`error` · `restriction` · `alert` · `pip`

---

## Infraestructura

| Feature | Archivos | Descripción |
|---------|----------|-------------|
| **Plugin System** | `src/plugins/index.js` | Carga dinámica condicional de analytics, DRM y ad plugins |
| **Event System** | `src/events/index.js` | Emitter interno y externo (`internalEmitter`, `externalEmitter`) |
| **Context/State** | `src/context/index.jsx` | React Context para estado global del player |
| **Error Handler** | `src/error/error.js` | Clases de error custom (`MediaError`, `PlayerInitError`) |
| **i18n** | `src/view/i18n/` | Internacionalización vía i18next |
| **Dev UI** | `src/dev-ui/` | UI de debug: event log, config viewer, control testing |
| **HTTP Request** | `src/helper/request.js` | Utilidad GET/POST |
| **External Import** | `src/helper/externalImport.js` | Carga dinámica de librerías externas |

---


## Resumen

| Categoría | Cantidad |
|-----------|----------|
| Sistemas de ads | 7 |
| Integraciones de analytics | 5 |
| Playback handlers | 3 |
| Sistemas DRM | 3 (Widevine, PlayReady, FairPlay) |
| Tipos de vista | 8 |
| Controles UI (video view) | 13+ |
| Componentes overlay | 18+ |
| Eventos públicos | 100+ |
| Métodos API | 17 |
| Propiedades API | 23 |
| QA Test Features Documentadas | 5 (konodrac v1.0 draft) |
