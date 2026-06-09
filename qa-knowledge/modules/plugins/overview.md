# Plugins — Overview

## Qué hace

El sistema de **plugins** es el mecanismo de extensibilidad opcional del Lightning Player. Carga de forma
**lazy** (vía `import()` dinámico de React) un conjunto de módulos satélite —analytics, ad systems, DRM,
metadata, federación— **en función de la configuración del player y del contenido inicial**, sin acoplarlos
al núcleo de reproducción.

Cada plugin es un **componente React** que se monta dentro del árbol del player pero **no renderiza UI**
(retornan `<React.Fragment />`). Su trabajo es ejecutar side-effects: suscribirse a eventos del player,
inicializar SDKs externos, enviar beacons, resolver URLs de DRM/DAI, etc.

Un detalle arquitectónico central: la reproducción **no comienza hasta que todos los plugins reporten que
están listos** (`pluginsReady()`). Esto permite que plugins como DRM o DAI resuelvan asincrónicamente el
`src` real (license discovery, manifest deferred) antes de que el elemento de video se monte.

## Archivos clave

| Archivo | Rol |
|---------|-----|
| `src/plugins/index.js` | Función `load(options)` — registro declarativo de plugins built-in y selección condicional según config |
| `src/plugins/baseComponent.js` | `MediastreamBaseComponent` — clase base con lifecycle `isReady()`/`getIsReady()`, `restart()`, detección de montaje/desmontaje y `wrap()` para inyectar contexto |
| `src/api/player.jsx` | `PluginLoader` — componente que invoca `load(options)`, instancia los plugins y los monta; reacciona a cambios de `options` |
| `src/context/index.jsx` | Provee `pluginsReady()` al contexto — agrega el estado `_isReady` de todos los componentes registrados |
| `src/helper/components/register.js` / `get.js` | Registro global (`_components`) donde cada instancia de plugin se registra para que `pluginsReady()` la consulte |
| `src/player/base.js` | `RenderElement` — suspende el render del `<video>` mientras `pluginsReady()` sea `false` |
| `constants.cjs` → `plugin.analytics.*` | URLs CDN de SDKs de plugins (comscore, etc.) resueltas por ambiente (dev/staging/prod) |

## Flujo de datos

```
options (config + initial content)
        │
        ▼
  plugins/index.js  load(options)
        │  (short-circuit: fatalError → {} ; reels → {})
        │  evalúa flags: youbora.enabled, comscore.enabled, konodrac.enabled,
        │  dnt, detectAdblocker, liveReactions, drm._candidateUrls,
        │  ads.googleDAI.backup, ads.mediaTailorDAI.enabled, ads.sgai.*
        ▼
  { Federation, PlayingMetadata, [YouboraTracker], [DRM], [GoogleDAI], ... }
        │
        ▼
  PluginLoader (api/player.jsx)
        │  map → <Plugin key={name} /> ; lazy import() resuelve el chunk
        ▼
  cada plugin = MediastreamBaseComponent
        │  _onMount → Promise.resolve(isReady()).finally(setData('_rnd'))
        ▼
  register(name, instance) → _components global
        │
        ▼
  context.pluginsReady() = _components.every(c => c.getIsReady?.() ?? true)
        │
        ▼  cuando TODOS ready
  RenderElement monta <video>/handler → playback arranca
```

## API pública

El sistema de plugins **no expone una API pública de registro de plugins de terceros** en la superficie
del player (no hay `player.registerPlugin(...)`). La extensibilidad es **interna/declarativa**: los plugins
built-in se listan en `src/plugins/index.js` y se activan vía **opciones de configuración del player**:

| Opción de config | Plugin activado | Condición |
|------------------|-----------------|-----------|
| `metadata.player.tracking.youbora.enabled` | YouboraTracker | truthy (`1`/`'1'`/`true`/`'true'`) |
| `metadata.player.tracking.comscore.enabled` (o `tracking.comscore`) | ComscoreTracker | truthy |
| `metadata.player.tracking.konodrac.enabled` | KonodracTracker | truthy |
| `analytics.google` | GoogleTracker | presente y `dnt` falsy |
| `dnt` falsy | StreamMetrics | siempre que no haya Do-Not-Track |
| `detectAdblocker` | DetectAdblocker | truthy |
| `liveReactions` + `type === 'live'` | LiveReactions | truthy y live |
| `drm._candidateUrls.{hls,mpd}` | DRM | hay candidate URLs |
| `ads.googleDAI.backup` + (`key`/`keyDash`/`sourceId`) | GoogleDAI | backup activado |
| `ads.mediaTailorDAI.enabled` | MediaTailorDAI | enabled (DAI de Google tiene prioridad) |
| `ads.sgai.{networkCode,customAssetKey}` + `enabled !== false` | GoogleSGAI | config SGAI presente |
| — (siempre) | Federation, PlayingMetadata | salvo fatalError / reels |

Estado público observable:
- Evento interno `pluginsReady` (`InternalEvents._pluginsReady`) en `constants.cjs`.
- `context.pluginsReady()` — predicado consumido por la capa de render.

## Interacciones con otros sistemas

- **events**: plugins se suscriben a `internalEmitter` / `externalEmitter`; algunos emiten `Events._error`.
- **playback-core**: bloquea el montaje del `<video>` hasta `pluginsReady()` → afecta TTFF (time-to-first-frame).
- **drm**: el plugin DRM resuelve `_candidateUrls` → `src` real y setea `vkeySystem` vía `setData`.
- **ads (DAI/SGAI/MediaTailor)**: difieren el `src` / manifest hasta que el SDK de ads esté inicializado.
- **analytics (youbora / comscore / streammetrics / ga / konodrac / reactions)**: consumidores principales.
- **metadata**: `PlayingMetadata` siempre montado.
- **federation**: siempre montado (salvo reels/fatal error).
- **platform-config**: `constants.cjs` resuelve URLs de SDK por ambiente.
