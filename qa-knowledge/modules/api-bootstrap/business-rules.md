# api-bootstrap — Business Rules

## Reglas de configuración obligatoria

**BR-BOOT-001** — `type` e `id` son requeridos para contenido de plataforma
Para cargar contenido de la plataforma Mediastream, la config debe incluir `type` (uno de: `media`, `episode`, `live`, `dvr`) e `id` (el ID del contenido). Sin ambos valores, no se fetcha la config de plataforma y el player queda sin fuente de reproducción. La excepción es el modo "dynamic" (`player=dynamic`) donde el integrador provee la src directamente.

**BR-BOOT-002** — `type` válidos para loadConfig son: `media`, `episode`, `live`, `dvr`
Cualquier otro valor de `type` lanza `PlayerInitError` con mensaje descriptivo. Los tipos `radio`, `podcast`, `audio` son implementados via el parámetro `view`, no como `type` de contenido. `type=episode` es equivalente a `media` internamente (remapeado en el componente React).

**BR-BOOT-003** — El script tag DEBE estar en `<body>` si no tiene `data-container`
Si el script está en `<head>` sin un `data-container` attribute que apunte a un elemento existente (o que existirá en `window.load`), el bootstrap falla con error explícito. Esta regla aplica al embed via script tag, no a `loadMSPlayer()`.

## Reglas de inicialización y ciclo de vida

**BR-BOOT-004** — `loadMSPlayer()` destruye automáticamente la instancia anterior
Si `loadMSPlayer()` es llamado mientras existe una instancia activa, esa instancia es destruida antes de crear la nueva. El integrador no necesita llamar `destroy()` manualmente entre llamadas a `loadMSPlayer()`. Sin embargo, si `destroy()` falla, el error es logueado pero el init de la nueva instancia continúa.

**BR-BOOT-005** — La inicialización es completamente asíncrona
El player NO está disponible síncronamente después de appendear el script tag. El único mecanismo confiable para obtener la instancia es: `data-loaded` callback, `playerloaded` CustomEvent, o `await window.loadMSPlayer()`. El `playerloaded` event garantiza que la UI (controles) está montada, no solo el React root.

**BR-BOOT-006** — `destroy()` es idempotente — segunda llamada no lanza excepciones por default
La segunda llamada a `destroy()` es no-op si el player ya está destruido (el React root ya está desmontado). Sin embargo, llamadas concurrentes (no secuenciales) a `destroy()` sí lanzan error por el guard de `_destroying`.

**BR-BOOT-007** — `loadConfig()` en la instancia no puede ejecutarse concurrentemente
Si `player.loadConfig()` es llamado mientras una llamada anterior está en curso, la segunda llamada lanza `Error: Loading config while already loading`. El integrador debe serializar las llamadas a `loadConfig()`.

## Reglas de configuración de ads

**BR-BOOT-008** — Config de ads del integrador tiene precedencia sobre config de plataforma
Los ads configurados en el script tag (`data-ads-map`) o en las opciones de `loadMSPlayer()` (`ads.map`) sobreescriben los ads configurados en la plataforma Mediastream. Esta regla permite a los integradores usar su propio sistema de monetización.

**BR-BOOT-009** — `data-ads-map='null'` (string) desactiva los ads
El valor string `'null'` en `data-ads-map` es normalizado a `null` en JavaScript, desactivando efectivamente cualquier ad configurado en plataforma. Este es el mecanismo oficial para crear embeds sin publicidad.

**BR-BOOT-010** — La normalización `adsMap → ads.map` ocurre en `_loadConfig()`
Los atributos `data-ads-map` se parseán inicialmente como `adsMap` (camelCase). La normalización posterior en `_loadConfig()` los mueve a `ads.map`. El resultado final es siempre `config.ads.map`, nunca `config.adsMap`.

## Reglas de parseo de atributos

**BR-BOOT-011** — Atributos `data-*` se convierten a camelCase
Todos los `data-*` attributes son convertidos a camelCase: `data-player-name` → `playerName`, `data-ads-map` → `adsMap`. La excepción son los `data-custom-*` que se agrupan en `config.custom.*` sin modificar la sub-key.

**BR-BOOT-012** — Atributos `data-custom-*` van a `config.custom.*`
Los `data-custom-*` attributes forman un namespace separado: `data-custom-foo` → `config.custom.foo`. No se aplica camelCase a la sub-key. Son accesibles para plugins y analytics.

**BR-BOOT-013** — Valores `$expr` son evaluados como JavaScript
Los valores de atributos que comienzan con `$` son evaluados como expresiones JavaScript en un scope aislado. Ejemplo: `data-volume="$window.DEFAULT_VOLUME"` resuelve a `config.volume = window.DEFAULT_VOLUME`. El eval ocurre en un closure sin acceso a variables minificadas del bundle.

**BR-BOOT-014** — `data-loaded` attribute no se incluye en `_config`
El atributo `data-loaded` está explícitamente excluido del parseo de `_config`. Es leído directamente de `_attributes` para invocar el callback. Esto evita que el nombre del callback contamine el config del player.

## Reglas de versionamiento y CDN

**BR-BOOT-015** — `api.js` tiene TTL de caché corto — solo él
Por diseño de deploy, `api.js` es el único archivo del bundle con TTL corto (minutes/hours). Todos los otros chunks (lazy-loaded) tienen TTL largo porque tienen hashes en el filename. Un cambio en `api.js` invalida el caché de todo el bundle via los nuevos hashes de dependencias.

**BR-BOOT-016** — La versión del player está disponible via `player.version`
La instancia del player expone un getter `version` que retorna la versión del bundle en formato semver (sin `v` prefix). El valor es inyectado por Webpack como `process.env.VERSION`.

## Reglas de comportamiento por ambiente

**BR-BOOT-017** — Los endpoints de plataforma varían por ambiente
- **develop**: `develop.mdstrm.com`
- **staging**: `staging.mdstrm.com`
- **producción**: `embed.mdstrm.com`

El endpoint activo es determinado por `embedHost` en `constants.cjs` según `process.env.CUSTOM_ENV`. Tests deben interceptar el dominio correcto según `PLAYER_ENV`.

**BR-BOOT-018** — `legacyApiCompat` solo activa en iframes bajo `.mdstrm.com`
La compatibilidad legacy (relay de eventos via postMessage) solo se activa si: (1) el player está en un iframe (`window.self !== window.top`) Y (2) el hostname termina en `.mdstrm.com`. Fuera de este contexto, no hay overhead de compatibilidad.

## Reglas de la industria aplicables

**BR-BOOT-IND-001** — La inicialización de player SDK debe fallar rápido con mensajes descriptivos
Derivado de patrones de Bitmovin (domain allowlisting), JW Player (license key), y Video.js. El error de inicialización debe incluir el motivo específico del fallo (qué campo es inválido, qué recurso no se encontró). Lightning cumple este patrón con sus mensajes de error en `getContainer()` y `PlayerInitError`.

**BR-BOOT-IND-002** — `destroy()` DEBE remover todos los event listeners para evitar memory leaks
Derivado de Video.js issue #6537 y hls.js issue #1220. El `destroy()` del player debe limpiar todos los listeners para que el GC pueda reclamar la memoria. En Lightning, el `internalEmitter.reset()` y el React root `unmount()` manejan esto. Los listeners de `window` en `legacyApiCompat` son el risk residual.

**BR-BOOT-IND-003** — Múltiples instancias en la misma página son soportadas pero cada una requiere su propio container
El patrón de la industria (JW Player, Bitmovin) permite múltiples instancias via containers distintos. `loadMSPlayer()` de Lightning solo gestiona una instancia (la más reciente destruye la anterior). Para múltiples instancias simultáneas se deben crear múltiples instancias con contenedores diferentes sin usar `loadMSPlayer()` como gestor.

**BR-BOOT-IND-004** — La separación entre player setup config y source config es un patrón recomendado
Bitmovin separa explícitamente la config del player (licencia, UI) de la config de la fuente (src, DRM, ads). Lightning tiene una separación similar: config del player (UI config del GET al endpoint player) vs config de contenido (content config del GET al endpoint de content). Esta separación permite re-usar la misma instancia del player con diferentes contenidos via `player.load()`.
