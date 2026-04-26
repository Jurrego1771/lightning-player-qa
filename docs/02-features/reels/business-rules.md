---
type: business-rules
feature: reels
version: "1.0"
status: draft
last_verified: 2026-04-26
---

# Business Rules — Reels

## Contexto: vistas que implementan la feature

| Vista | UI | Auto-Load | Controles bloqueados |
|---|---|---|---|
| `reels` | Swiper vertical, full-screen per slide | Sí (primer ítem) | No — `goNext`/`goPrevious` expuestos |

[CODE: src/view/index.jsx:14]

---

## BR-01 — El view type `reels` se activa pasando `view: 'reels'` en la config

El `ViewWrapper` lee `options.view` del contexto. Si `view` es el string `'reels'`, carga el componente `ReelsPlayer` vía lazy import.

[CODE: src/view/index.jsx:14,44-47]

---

## BR-02 — La plataforma NO se consulta para obtener config de contenido en el modo reels

En `_loadConfig`, si el `viewType` es `'reels'` se omite completamente el request a la plataforma (`develop.mdstrm.com`). El reels player carga su propio contenido por instancia interna usando el `id` y `type` pasados directamente.

[CODE: src/api/api.js:105]

---

## BR-03 — Ningún plugin de analytics ni ads se carga en el contenedor padre de reels

El sistema de plugins devuelve `{}` (objeto vacío) cuando detecta `view.type === 'reels'`. Analytics (StreamMetrics, Comscore, Youbora), DRM, Google IMA, DAI, SGAI, AdSwizz y detección de ad blocker no se inicializan en la capa del player padre.

[CODE: src/plugins/index.js:27-31]

---

## BR-04 — Cada ítem de contenido instancia un player Lightning Player hijo independiente

Cada slide de video crea dinámicamente un elemento `<script src="api.js">` con:
- `data-player="dynamic"` (evita cargar config de la plataforma repetidamente)
- `data-ads-map="null"` (deshabilita ads IMA en la instancia hijo)
- `data-disable-msp-events="true"` (las instancias hijo no se coordinan entre sí vía MSP events globales)

Después de que el script callback (`data-loaded`) es invocado, el player hijo recibe `loadConfig()` con `view: 'none'`, el `id` y `type: 'media'`, y `autoplay: false`.

[CODE: src/view/reels/components/video.js:83-136]

---

## BR-05 — El tipo de contenido de los ítems individuales es siempre `media`

El endpoint `/api/media/{id}/related/reels` devuelve ítems cuyo tipo es hardcodeado como `'media'`. No se soportan ítems de tipo `live`, `dvr`, `audio`, `radio` ni `podcast` dentro de un feed de reels.

[CODE: src/view/reels/atoms/fetchMoreItems.js:48-54]

---

## BR-06 — El primer ítem se carga desde el `id`/`type` del contexto del player padre

Al inicializar, `loadFirstItemAtomEffect` lee `id` y `type` del contexto y los usa para pre-poblar la lista con `[{ id, type }]`. Los ítems subsecuentes se obtienen via fetch.

[CODE: src/view/reels/atoms/items.js:68-77]

---

## BR-07 — Los ítems adicionales se obtienen de la API `related/reels` del último ítem no-ad

Cuando `currentIndex + itemsToPreload > itemsLength - 1`, se dispara un fetch a `${protocol}://${embedHost}/api/media/${lastItemId}/related/reels?player=...&display=N`. Las respuestas se cachean por `lastItemId` para evitar re-fetching de la misma fuente.

`embedHost` se resuelve como `develop.mdstrm.com` por defecto (env `EMBED_HOST`).

[CODE: src/view/reels/atoms/fetchMoreItems.js:18-27, 38-56, 96-107]
[CODE: src/constants.js:15-16]

---

## BR-08 — Preload y keep-in-memory son configurables, con mínimo de 1

| Parámetro | Fuente primaria | Fuente secundaria (player config) | Valor default | Mínimo |
|---|---|---|---|---|
| `videosPreload` | `data-videos-preload` / `videosPreload` en contexto | `view.reelsPreload` | `2` | `1` |
| `videosInMemory` | `data-videos-in-memory` / `videosInMemory` en contexto | `view.keepInMemory` | `2` | `1` |

`itemsToPreloadAtom` controla cuántos ítems se precargan (hacia adelante desde el índice actual).
`itemsToKeepInMemoryAtom` controla cuántos ítems se mantienen cargados en memoria detrás del índice actual.

[CODE: src/view/reels/atoms/config.js:4-19]

---

## BR-09 — Autoplay: el primer ítem se reproduce automáticamente si `autoplay` es truthy y es el ítem activo

El parámetro `autoplay` del player padre se hereda. El primer video (`index === 0`) recibe `mustAutoplay = autoplay && isFirstItem`. Cuando su `api` está lista y es el slide activo (`current`), llama `api.play()`.

Videos posteriores al primero se inicializan con `autoplay: false` via `loadConfig`.

[CODE: src/view/reels/components/video.js:71, 167-178]

---

## BR-10 — Al cambiar de slide, el ítem activo anterior se pausa y el nuevo se reproduce

`currentItemAutoplayAtomEffect` mantiene invariante: cuando `currentItemApiAtom` cambia, llama `api.play()` sobre el nuevo ítem activo y en su cleanup llama `api.pause()` sobre el ítem anterior.

[CODE: src/view/reels/atoms/autoplay.js:91-108]

---

## BR-11 — El player padre preloads los ítems prev y next al primer click/touch/keydown del usuario

`initializeItemsAtomEffect` escucha eventos globales `click`, `touchstart` y `keydown`. En el primer disparo, llama `initializeItemApi()` sobre los ítems prev y next. Esto es necesario para desbloquear autoplay en contextos donde el navegador requiere interacción previa.

`initializeItemApi()` llama `element.play()` seguido de `element.pause()` (para `<video>` elements) o `api.initialize()` (para slots de ads). Si el navegador rechaza con `NotAllowedError`, no marca el ítem como inicializado y se reintentará en el próximo evento.

[CODE: src/view/reels/atoms/autoplay.js:6-75]

---

## BR-12 — El ítem prev y next se precargan vía `api.load()` cuando su `readyState === 0`

`preloadNextItemAtomEffect` y `preloadPrevItemAtomEffect` verifican `readyState === 0` (sin datos cargados) y llaman `api.load()`.

[CODE: src/view/reels/atoms/autoplay.js:77-88]

---

## BR-13 — Los ítems fuera del rango de memoria se desmontan del DOM

`loadItemsAtomEffect` mantiene `item.loadAtom` a `true` solo para el rango `[currentIndex - itemsToKeepInMemory, currentIndex + itemsToPreload)`. Cuando un ítem sale del rango, su `loadAtom` se pone en `false` y el componente `Video` retorna `null`, desmontando el DOM. Al desmontarse, el `apiAtomFamily` llama `api.destroy()`.

[CODE: src/view/reels/atoms/items.js:79-116]
[CODE: src/view/reels/components/video.js:183-185]

---

## BR-14 — El volumen es persistido entre ítems (incluyendo ads)

`volumeAtomEffect` escucha el evento `volumechange` del ítem activo y persiste el valor en `volumeInnerAtom`. Al cambiar de ítem activo, el cleanup pasa `api.volume = currentVolume` al siguiente ítem (excepto a ads — los ads reciben el volumen en su setup via `volumeAtomEffect` cuando se inicializan). Los ítems no-primeros se crean con `volume: 1` para no bloquear la inicialización del player.

[CODE: src/view/reels/atoms/volume.js:1-59]
[CODE: src/view/reels/components/video.js:55-65]

---

## BR-15 — La navegación vertical usa Swiper con Mousewheel y Keyboard habilitados

El Swiper se configura con:
- `direction: 'vertical'`
- `slidesPerView: 1`
- `Mousewheel: { thresholdTime: 1000, thresholdDelta: 100 }`
- `Keyboard: true`

El índice activo se sincroniza con `currentIndexAtom` con un `setTimeout(..., 0)` para evitar crash en iOS.

[CODE: src/view/reels/components/videoReels/index.js:78-96]
[CODE: src/view/reels/components/videoReels/index.js:69-75]

---

## BR-16 — Los botones de navegación prev/next están deshabilitados en los extremos de la lista

`isFirst = currentIndex === 0` deshabilita el botón "anterior".
`isLast = currentIndex === itemsLength - 1` deshabilita el botón "siguiente".

[CODE: src/view/reels/components/controls.js:76-78]

---

## BR-17 — El player padre expone `goNext` y `goPrevious` en la API pública

`ReelsControls` llama `expose()` que define `goNext` y `goPrevious` como propiedades en `LightningPlayer.prototype`. Llaman `swiper.slideNext()` / `swiper.slidePrev()` con un delay de 10ms.

También expone: `play`, `pause`, `currentTime` (get/set), `paused`, `status`, `metadata`, `volume` (get/set).

[CODE: src/view/reels/components/controls.js:112-166]
[CODE: src/controls/methods.js:9-16]

---

## BR-18 — El evento `metadatachanged` del ítem activo se reenvía al emitter interno del player padre

`ReelsControls` escucha `metadatachanged` del `currentItemApi` y emite `internalEmitter.emit(Events._metadatachanged, normalizedMetadata)`. La metadata se enriquece con `playerType: 'reels'`. Los metadatos de ads (sin content id) y los duplicados (mismo `id|src` key) se ignoran.

[CODE: src/view/reels/components/controls.js:84-108]

---

## BR-19 — La metadata disponible por ítem: title, description, tags, date

`getMetadata()` extrae del objeto metadata del player hijo:
- `title` (`metadata.title`)
- `description` (`metadata.description`)
- `tags` (`metadata.tags`)
- `date` (`metadata.date_recorded` o `metadata.date_created`)

Las fechas se formatean como tiempo relativo (si < 24h) o fecha `DD-MM-YYYY` con locale `es-CL`. Ambos formatos tienen un `FIXME` sobre locale.

[CODE: src/view/reels/atoms/metadata.js:7-16]
[CODE: src/view/reels/components/videoControls/metadata/hooks/useMetadata.js:1-44]

---

## BR-20 — El ProgressBar de contenido soporta seek; el ProgressBar de ads no

`VideoControls` pasa `allowSeek={true}` para ítems de contenido y `allowSeek={false}` para `AdSlot`. Cuando `allowSeek` es `false`, el click handler y el drag tracking no se registran.

[CODE: src/view/reels/components/adSlot/index.js:103]
[CODE: src/view/reels/components/videoControls/progressBar.js:14,49-53]

---

## BR-21 — La vista usa layout desktop cuando el ancho del contenedor supera 640px

`useMeasure` mide el ancho horizontal del contenedor. Si `width > 640`, se aplica la clase CSS `desktop_view`.

[CODE: src/view/reels/index.js:24-28]

---

## BR-22 — El componente `resumeBuffering` / `pauseBuffering` se llama en el ítem activo

`RenderItem` llama `api.resumeBuffering()` cuando el slide se vuelve activo y `api.pauseBuffering()` en cleanup. Ambas llamadas están en `try/catch` porque los ads no exponen estos métodos.

[CODE: src/view/reels/components/videoReels/index.js:19-31]

---

## API pública — Métodos exclusivos de la vista Reels

```js
player.goNext()      // Avanza al siguiente slide (llama swiper.slideNext() con 10ms delay)
player.goPrevious()  // Retrocede al slide anterior (llama swiper.slidePrev() con 10ms delay)
```

[CODE: src/view/reels/components/controls.js:55-71, 149-154]

## API pública — Propiedades expuestas por el contenedor Reels

| Propiedad | Tipo | Notas |
|---|---|---|
| `play` | Function | Del ítem activo actual |
| `pause` | Function | Del ítem activo actual |
| `currentTime` | number (get/set) | Del ítem activo actual |
| `paused` | boolean | Del ítem activo actual |
| `status` | string | Del ítem activo; `'error'` si hay error global o del ítem |
| `metadata` | object | Del ítem activo, enriquecido con `playerType: 'reels'` |
| `volume` | number (get/set) | Volumen persistido entre ítems |
| `goNext` | Function | Navegar al siguiente slide |
| `goPrevious` | Function | Navegar al slide anterior |

[CODE: src/view/reels/components/controls.js:112-162]

---

## Ads en Reels (VAST)

### BR-23 — Los ads se habilitan solo si se provee una VAST URL

`adsEnabledAtom` es `true` si y solo si `vastUrlAtom` tiene un valor no-vacío. La URL se resuelve desde `adsVast` (contexto directo, ej. `data-ads-vast`) o `view.ads.vast` (player config).

[CODE: src/view/reels/atoms/config.js:24-37]

### BR-24 — Los ad slots se insertan en la lista cada N ítems de contenido (mínimo 4)

`adsIntervalAtom` lee de `adsInterval` (contexto directo) o `view.ads.interval` (player config), con default `5` y mínimo `4`. Cuando se agregan nuevos ítems, se insertan `adItem` objetos con `is_ad: true` en los índices calculados. Cada ad item tiene su propio `vastAtom` (lazy-loaded).

[CODE: src/view/reels/atoms/config.js:40-54]
[CODE: src/view/reels/atoms/items.js:131-175]

### BR-25 — Los ad slots fallidos se eliminan de la lista automáticamente

`removeBadAdsAtomEffect` verifica los ítems adyacentes al índice actual. Si un ítem `is_ad` tiene `isValidAtom === false` (es decir, ni está cargando ni tiene adsManager), se elimina de `itemsInnerAtom` y se ajusta `adLastItemIndexAtom`.

[CODE: src/view/reels/atoms/vast.js:9-27]

### BR-26 — El ad loop: cuando un ad completa, se repite en loop

Cuando el `AdsManager` recibe el evento `Complete`, establece `innerPlayer.loop = true` y llama `play()` desde cero. El evento `Complete` hace `preventDefault()` para evitar que el adsManager avance al siguiente ad o se desmonte.

[CODE: src/view/reels/utils/adsManager.js:52-62]

### BR-27 — El título y descripción del ad son configurables por player config

`showAdsTitleAtom` y `showAdsDescriptionAtom` leen de `adsShowTitle`/`view.ads.showTitle` y `adsShowDescription`/`view.ads.showDescription`. Los valores `false`, `'false'`, `'0'`, `0` deshabilitan el campo correspondiente. Por defecto ambos están habilitados (truthy si no se especifica).

[CODE: src/view/reels/atoms/config.js:56-68]
[CODE: src/view/reels/atoms/metadata.js:26-31]
