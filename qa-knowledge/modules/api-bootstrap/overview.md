# api-bootstrap — Overview

## Qué hace

El módulo `api-bootstrap` es el **punto de entrada único** del Lightning Player. Gestiona la inicialización del player desde el DOM, parsea la configuración del script tag (o recibe config programática vía `loadMSPlayer()`), fetcha la config de plataforma Mediastream, monta el árbol React y expone la API pública de la instancia.

Es el único archivo del player con TTL de caché corto en CDN — por diseño se mantiene mínimo, ya que un cambio aquí invalida el caché de todas las dependencias lazy-loaded.

## Archivos clave

| Archivo | Rol |
|---------|-----|
| `src/api/api.js` | Bootstrap principal: parse de `data-*`, lazy loading de deps, init, `loadMSPlayer()` |
| `src/api/player.jsx` | Clase `LightningPlayer`: monta React, expone API pública (`on`, `off`, `load`, `destroy`, `loadConfig`, etc.) |
| `src/api/legacyApiCompat.js` | Compat capa legacy: relay de eventos a `window.parent` vía `postMessage` (solo activo en iframes bajo `.mdstrm.com`) |
| `src/platform/loadConfig.js` | Fetcha config de contenido de la plataforma Mediastream — usado tanto en bootstrap como en `player.load()` |

## Flujo de datos

```
Browser carga api.js
        │
        ▼
[1] Localizar script tag / div[data-msp]
        │
        ▼
[2] Parse data-* attributes → _config (camelCase)
    data-custom-* → config.custom.*
    $expr → eval() (scope aislado)
        │
        ▼
[3] ¿Tiene data-id / data-loaded / data-global / data-container?
    ├─ SÍ → init() (embed inmediato)
    └─ NO → exponer window.loadMSPlayer() (modo programático)
        │
        ▼
[4] loadDependencies() en paralelo:
    ├─ getContainer() — resolve/create contenedor DOM
    ├─ import('./player') — LightningPlayer class
    ├─ GET embed.mdstrm.com/{type}/{id}/player/{playerId} — UI config (player config)
    └─ legacyApiCompat (solo si iframe en .mdstrm.com)
        │
        ▼
[5] _loadConfig() — merge config local + plataforma
    ├─ GET embed.mdstrm.com/{renderAs}/{id}.json — content config (src, ads, DRM, subtitles)
    ├─ Manejo de error: err.fatal = true → merge en config como error state
    ├─ Normalización: adsMap → ads.map, withoutCookies coerce, view string → object
    └─ Default aspectRatio 16/9 si renderAs=video sin height
        │
        ▼
[6] new LightningPlayer(container, config, _loadConfig)
    ├─ Inicia React root (createRoot)
    ├─ Registra 'container' y 'api' en el registro de componentes
    └─ Aplica msvid/msm de query string (deep link share)
        │
        ▼
[7] Espera InternalEvents._controlsReady (excepto player=dynamic)
        │
        ▼
[8] Callbacks de carga:
    ├─ data-global → window[nombre] = player
    ├─ data-loaded → eval(nombre)(player)
    └─ CustomEvent 'playerloaded' disparado en script tag con { detail: player }
        │
        ▼
[9] Si script tag es DIV: se elimina del DOM
    Si en iframe .mdstrm.com: legacyApiCompat(player) activa relay de eventos
```

## API pública

### Métodos de la instancia (`LightningPlayer`)

| Método | Firma | Descripción |
|--------|-------|-------------|
| `on` | `(event: string, cb: Function) → void` | Suscribir a evento del player |
| `once` | `(event: string, cb: Function) → void` | Suscribir a evento una vez |
| `off` | `(event: string, cb: Function) → void` | Desuscribir de evento |
| `addEventListener` | `(event, cb)` | Alias de `on` |
| `removeEventListener` | `(event, cb)` | Alias de `off` |
| `load` | `async ({ type, id, ...opts }) → void` | Cambiar contenido sin destruir el player |
| `destroy` | `async () → void` | Desmontar React, limpiar Chromecast, reset emitter |
| `loadConfig` | `async (configOpts) → void` | Reinicializar el player con nueva config |
| `getOption` | `(key: string) → any` | Leer una opción de la config inicial |
| `getOptions` | `() → object` | Leer todas las opciones |
| `setOption` | `(key: string, val: any) → void` | Mutar una opción (actualiza estado interno) |
| `keepWatching` | `() → { success: boolean }` | Prevenir auto-carga del siguiente episodio |
| `playNext` | `() → { success: boolean }` | Cargar siguiente episodio inmediatamente |
| `updateNextEpisode` | `(data) → void` | Actualizar datos del siguiente episodio |

### Getter de solo lectura

| Propiedad | Tipo | Descripción |
|-----------|------|-------------|
| `version` | `string` | Versión del player (ej: `"1.0.75"`) |

### API global (expuesta en `window`)

| Nombre | Firma | Descripción |
|--------|-------|-------------|
| `window.loadMSPlayer` | `(container: string\|HTMLElement, opts?: PlayerConfig) → Promise<PlayerAPI>` | Inicialización programática. Destruye instancia previa si existe. |

### Eventos emitidos por bootstrap

| Evento | Tipo | Cuándo |
|--------|------|--------|
| `playerloaded` | `CustomEvent` en el script tag | Player inicializado y lista la API |
| `ready` | Player event | Player listo para recibir comandos |
| `error` | Player event | Error fatal durante load (ej: 404 en plataforma) |

### Config options principales (data-* / loadMSPlayer options)

| Key (camelCase) | data-* attribute | Tipo | Requerido | Descripción |
|-----------------|-----------------|------|-----------|-------------|
| `type` | `data-type` | `'media'\|'live'\|'dvr'\|'episode'` | Sí (para contenido) | Tipo de contenido |
| `id` | `data-id` | `string` | Sí (para contenido) | ID del contenido en plataforma |
| `player` | `data-player` | `string` | No | ID de config de UI del player |
| `container` | `data-container` | `string\|HTMLElement` | No | ID del elemento contenedor |
| `autoplay` | `data-autoplay` | `boolean` | No | Autoplay al cargar |
| `loaded` | `data-loaded` | `string` (fn name) | No | Callback al estar listo |
| `global` | `data-global` | `string` | No | Nombre de variable global |
| `ads` | `data-ads-map` | `object` | No | Config de ads (ads.map = VAST URL) |
| `withoutCookies` | `data-without-cookies` | `boolean` | No | Sin cookies de tracking |
| `dnt` | `data-dnt` | `boolean` | No | Do Not Track |
| `debug` | `data-debug` | `boolean` | No | Modo debug del emitter |
| `view` | `data-view` | `string\|object` | No | Tipo de vista (video/audio/radio/etc.) |
| `format` | `data-format` | `'hls'\|'dash'\|'mpd'` | No | Forzar formato de stream |
| `accessToken` | `data-access-token` | `string` | No | Token de acceso restringido |
| `startPos` | `data-start-pos` | `number` | No | Posición inicial en segundos |
| `custom.*` | `data-custom-*` | `any` | No | Metadata custom (plugins/analytics) |

## Interacciones con otros sistemas

| Sistema | Tipo de interacción | Criticidad |
|---------|--------------------|-----------:|
| `platform/loadConfig` | Fetch HTTP a Mediastream API para obtener src, ads, DRM, subtitles | Crítica |
| `events` (`internalEmitter`) | Bus de eventos interno — reset en destroy, debug flag | Alta |
| `events` (`externalEmitter`) | Bus de eventos público — métodos on/once/off de la API | Alta |
| `plugins` | Cargados via React Suspense en `player.jsx` — lazy import | Media |
| `context` | React Context Provider con estado del player | Alta |
| `view` | Árbol de UI React montado debajo del Context Provider | Alta |
| `chromecast` | `cleanupChromecast()` llamado en `destroy()` | Media |
| `legacyApiCompat` | Relay de eventos a parent frame vía postMessage (iframe .mdstrm.com) | Baja |
| CDN (player.cdn.mdstrm.com) | Sirve `api.js` — único archivo con TTL corto | Crítica |

## Notas de comportamiento no obvias

- **`data-*` con `$` prefix**: Los valores que empiezan con `$` se evalúan como expresiones JS en un scope aislado (para evitar que el ofuscador de webpack rompa las variables). Ej: `data-volume="$window.DEFAULT_VOLUME"`.
- **Script en `HEAD` sin `data-container`**: Falla con error explícito — el script necesita estar en el `body` OR tener un container definido.
- **`player=dynamic`**: Modo especial que bypasea la carga de UI config del player (GET al endpoint de player). Útil para embeds headless o plataformas custom.
- **Carga doble de `api.js`**: Si `api.js` se carga dos veces, la segunda ejecución expone `window.loadMSPlayer`, por lo que no duplica instancias automáticamente — la llamada explícita destruye la instancia previa.
- **`type=episode`**: Internamente mapeado a `'media'` por `LightningPlayerInterface` (prop `mappedType`). El tipo original se preserva en `originalType`.
- **`type=reels`**: Salta el fetch de content config de plataforma (viewType check en `_loadConfig`).
