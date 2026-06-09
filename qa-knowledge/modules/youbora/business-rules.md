# Youbora (NPAW) — Business Rules

Reglas derivadas del código fuente (`src/analytics/youbora/tracker.js`, `index.jsx`, `src/plugins/index.js`) y de la práctica de la industria OTT / protocolo NPAW.

## Reglas de activación

**BR-YBRA-001** — account_code es obligatorio para emitir beacons
`tracker.init()` retorna sin efecto si `accountCode` es falsy (`if (!accountCode) return`, tracker.js:72). Sin account_code no se instancia `NpawPlugin` y no se emite ningún beacon. El string vacío `''` es falsy y cae en el mismo guard. (Cubre YBRA-AC-002.)

**BR-YBRA-002** — Youbora se activa solo con enabled truthy en config de plataforma
`plugins/index.js` monta `YouboraTracker` solo si `metadata.player.tracking.youbora.enabled` está en `[1, '1', true, 'true']`. `false`, ausente, u otros valores → no se monta el componente. (Cubre YBRA-AC-001, YBRA-AC-003.)

**BR-YBRA-003** — Do-Not-Track y reels desactivan TODO el tracking
Si `options.dnt` está en `[1, '1', true, 'true']`, o `options.view === 'reels'`, o hay error fatal en options, `plugins/index.js` no carga NINGÚN plugin (incluido Youbora) aunque `enabled=true`. El cumplimiento de DNT tiene prioridad sobre la activación de analítica.

## Reglas de sesión (View lifecycle)

**BR-YBRA-004** — Una View por reproducción; abre en firstPlay, cierra en ended/stop
La View se abre con `fireStart()`+`fireJoin()` en `contentFirstPlay` (o primer `playing` fuera de ad break) y `_started` pasa a `true`. Se cierra con `fireStop()` en `ended`, donde `_started` vuelve a `false`. (Cubre YBRA-AC-004, YBRA-AC-009.)

**BR-YBRA-005** — load() con contenido distinto reinicia la sesión; mismo contenido la actualiza
`index.jsx` compara `id`, `type`, `accountCode`. Si cambia alguno → `tracker.restart()` (cierra la View previa con `fireStop` y abre una nueva). Si no cambian → `tracker.updateOptions()` (mantiene la View, solo `setVideoOptions`). El viewCode (`code`) de la nueva View debe ser distinto. (Cubre YBRA-AC-015, YBRA-AC-016.)

**BR-YBRA-006** — restart() difiere la nueva sesión un tick (setTimeout 0)
`restart()` ejecuta `_cleanup()` y agenda `init()` con `setTimeout(0)` guardado en `_pendingInit`. `_cleanup()`/`destroy()` cancelan ese timeout con `clearTimeout`. La nueva sesión depende de que el player reemita `Events._playing` tras el tick (relevante en next-episode). (Ver YBRA-DEF-004, YBRA-DEF-006.)

**BR-YBRA-007** — destroy() cierra la sesión y desuscribe sin propagar errores
`destroy()` → `_cleanup()`: `clearTimeout(_pendingInit)`, `internalEmitter.off()` de todos los handlers, `fireStop()`, `removeAdsAdapter()`, `removeAdapter()`, y resetea todo el estado. Envuelto en try/catch — un error del SDK no rompe el teardown. Si `destroy()` ocurre antes de `contentFirstPlay`, no hay View de sesión que cerrar (no /start ni /joinTime). (Cubre YBRA-AC-017.)

**BR-YBRA-008** — La reproducción nunca debe degradarse por fallos de Youbora
`init()` está envuelto en try/catch (tracker.js:74-112). Cualquier excepción del SDK se absorbe (warn solo fuera de producción). El player debe seguir reproduciendo aunque NPAW falle, el CDN del SDK esté caído, o un ad blocker bloquee los beacons. (Cubre YBRA-RISK-001, YBRA-RISK-002.)

## Reglas de pausa / seek / buffer

**BR-YBRA-009** — firePause es idempotente vía guard _paused
`onPause` retorna si `_paused` ya es `true` (o si `!_started`, `_inAdBreak`, `!_adapter`). Doble pausa → un solo `/pause`. `onPlaying` con `_paused=true` dispara `fireResume()` y resetea el flag. (Cubre YBRA-AC-005, YBRA-AC-006.)

**BR-YBRA-010** — seek y buffer solo se reportan con sesión activa y fuera de ad break
`onSeeking/onSeeked/onBuffering/onCanPlay` requieren `_adapter && _started && !_inAdBreak`. El seek NO debe cerrar la View. El buffer underrun reporta `bufferDuration` (ms) al recuperar. (Cubre YBRA-AC-007, YBRA-AC-008.)

## Reglas de ads (adapter separado)

**BR-YBRA-011** — Las métricas de ads viven en un adapter independiente del de contenido
`registerDefaultAdsAdapter()` crea un ad adapter separado. El ciclo es `fireBreakStart` → `fireStart`/`fireJoin` (del ad) → `fireQuartile(1/2/3)` → `fireStop` → `fireBreakStop`. Las métricas de ad (adTitle, adDuration, adProvider, skippable, position, breakNumber) no se mezclan con las de contenido.

**BR-YBRA-012** — Durante el ad break el tracking de contenido queda enmascarado
`_inAdBreak=true` (en `adsContentPauseRequested`) hace que TODOS los handlers de contenido retornen temprano. El playhead de contenido se congela en `_contentPlayheadAtBreak`. En `adsContentResumeRequested` → `_inAdBreak=false` y `fireResume()` del contenido. (Cubre YBRA-AC-011.)

**BR-YBRA-013** — Pre-roll abre la View de contenido (en pausa) antes del primer ad
Si llega `adsContentPauseRequested` sin sesión (`_started=false`), se fuerza `fireStart`+`fireJoin` y `firePause` para que los pings del ad lleven un playhead de contenido coherente (=0). (Ver YBRA-LEARN-005, YBRA-RISK-007.)

**BR-YBRA-014** — adInsertionType es 'client' (CSAI) para ads de IMA
`getAdInsertionType` devuelve `'client'`. El tracker reporta inserción client-side (CSAI). DAI/SSAI usaría otro flujo (no este adapter). `getIsSkippable` = `skipOffset !== -1`.

## Reglas de metadata

**BR-YBRA-015** — content.type mapea live/dvr→Live/DVR y resto→VOD; duración -1 en live
`mapContentType`: `'live'→'Live'`, `'dvr'→'DVR'`, otro→`'VOD'`. `content.isLive` es `true` para live/dvr. `content.duration` es `-1` en live/dvr y `api.duration` en VOD. (Cubre NPAW-2.4, NPAW-2.6, NPAW-2.33.)

**BR-YBRA-016** — Metadata de episodio se incluye solo si está presente (optional chaining)
Para `type='episode'`: `content.program` solo si `metadata.show`, `content.season` solo si `metadata.season != null`, y `content.episodeTitle = title` siempre. Campos ausentes se omiten sin crash. (Cubre YBRA-AC robustez de episodios.)

**BR-YBRA-017** — user.type / user.name provienen de customer_extras (issue-706)
`contextMapper` lee `options['customer_extras.type']` → `userType` y `options['customer_extras.name']` → `userName`. `buildVideoOptions` los incluye solo si están presentes. Si la plataforma no los provee, se omiten (causa de YBRA-DEF-005).

**BR-YBRA-018** — playerName y appName por defecto son 'lightning-player'; versiones desde build
`getPlayerName` = `'lightning-player'`; `app.name` = `appName || 'lightning-player'`; `playerVersion`/`app.releaseVersion` = `process.env.VERSION` sin la 'v' inicial (observado: 1.0.75). `pluginVersion`/`pluginInfo` los aporta el SDK (7.3.28-generic-js).

## Reglas de la industria aplicables

**BR-YBRA-IND-001** — Join time, rebuffering ratio y EBVS son las métricas QoE estrella
La industria OTT (NPAW, Conviva, Mux) trata Video Startup Time (`/joinTime`), Rebuffering Ratio (`/bufferUnderrun` sobre watch time) y EBVS (Views con /start sin /joinTime) como los indicadores QoE más correlacionados con churn. El player debe reportarlas con fidelidad; actualmente EBVS (YBRA-DEF-007) y startup errors (YBRA-DEF-001) están degradados.

**BR-YBRA-IND-002** — La analítica debe ser fail-safe (nunca degradar la reproducción)
Práctica estándar: un fallo del SDK de analítica, del collector, o un bloqueo por ad blocker NO debe afectar la experiencia de reproducción. Lightning lo cumple vía try/catch + carga lazy + no-op cuando falta config.

**BR-YBRA-IND-003** — Los beacons de tracking pueden ser bloqueados; mitigar con first-party
Ad blockers y tracking protection bloquean dominios de analítica reconocidos. La mitigación de industria es servir el collector como first-party (proxy bajo el dominio propio). Sin ello, el subreporte por bloqueo es esperable y debe contemplarse al interpretar dashboards.

**BR-YBRA-IND-004** — bitrate=-1 es válido cuando el player no expone bitrate
Por protocolo NPAW, `-1` significa 'no reportado'. `bitrate` y `totalBytes` no deben enviarse simultáneamente. Un `-1` sistemático sesga la distribución de bitrate y debería investigarse a nivel de handler, no del tracker.

**BR-YBRA-IND-005** — Usar el SDK NPAW moderno (7.x generic-js, POST JSON), no adapters legacy GET
NPAW reemplazó los adapters HTML5 6.x (beacons GET con params en query) por el genérico integrado en `npaw-plugin` 7.x (POST con body JSON). Lightning usa 7.3.28. Tests y aserciones deben leer el POST body, no parsear query params al estilo 6.x.
