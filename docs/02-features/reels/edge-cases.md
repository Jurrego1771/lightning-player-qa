---
type: edge-cases
feature: reels
version: "1.0"
status: draft
last_verified: 2026-04-26
---

# Edge Cases — Reels

## EC-01 — Swipe rápido en iOS puede crashear Swiper y volver al primer slide

Un comentario en el código indica que en iOS, si `setCurrentIndex` se llama sincrónicamente dentro del callback `onSlideChange`, Swiper puede "crashear" y volver al primer ítem. La solución actual es un `setTimeout(..., 0)`.

[CODE: src/view/reels/components/videoReels/index.js:70-75]
Coverage: ❌ Sin test

---

## EC-02 — Autoplay bloqueado por política del navegador (NotAllowedError)

`initializeItemApi` captura errores de `play()`. Si el error es `NotAllowedError`, el ítem no se marca como inicializado y se reintentará en el próximo evento de interacción del usuario. Si es cualquier otro error, se marca como inicializado (se considera éxito implícito).

[CODE: src/view/reels/atoms/autoplay.js:44-58]
Coverage: ❌ Sin test

---

## EC-03 — Swipe muy rápido antes de que el player hijo cargue (`api === null`)

Si el usuario navega antes de que el player hijo haya completado su inicialización (script tag + loadConfig + `ready`), `currentItemApiAtom` es `null`. `currentItemAutoplayAtomEffect` verifica `if (!api) return`, así que no hay crash. El play se disparará cuando el atom reciba el valor no-nulo.

[CODE: src/view/reels/atoms/autoplay.js:91-97]
Coverage: ❌ Sin test

---

## EC-04 — El primer ítem del feed no tiene metadata (title y description son null)

`ReelsControls.forwardMetadata` invoca `getMetadataKey`. Si la metadata no tiene `id` ni `mediaId`, la key devuelve `null` y el evento `metadatachanged` al padre NO se emite para ese ítem. El componente `Metadata` tampoco renderiza si `!title && !description && !children`.

[CODE: src/view/reels/components/controls.js:36-45]
[CODE: src/view/reels/components/videoControls/metadata/index.js:28]
Coverage: ❌ Sin test

---

## EC-05 — El endpoint `related/reels` devuelve un array vacío o falla la red

`fetchDataInnerAtom` retorna `resp || []`. Si la respuesta no tiene `medias` o la red falla, `fetchItems` en `fetchDataFromNetworkAtomEffect` verifica `!fetchItems?.length` y no agrega ítems. El feed simplemente deja de crecer. No hay evento público de "fin de feed".

[CODE: src/view/reels/atoms/fetchMoreItems.js:47-55]
[CODE: src/view/reels/atoms/fetchMoreItems.js:88-107]
Coverage: ❌ Sin test

---

## EC-06 — Los ítems destruidos se recargan si el usuario regresa a ellos (fuera del rango de memoria)

Si un usuario navega hacia adelante más allá de `itemsToKeepInMemory` ítems y luego regresa, los ítems que salieron del rango tienen `loadAtom = false` y fueron desmontados + destruidos. Al volver a entrar en rango, `loadAtom` se pone en `true` y se monta un nuevo player hijo con un nuevo `key` (incluye `Date.now()`). El nuevo player hijo vuelve a cargar el contenido desde cero.

[CODE: src/view/reels/atoms/items.js:91-116]
[CODE: src/view/reels/components/video.js:183-185]
Coverage: ❌ Sin test

---

## EC-07 — Un ad slot cargando se convierte en inválido antes de mostrarse (VAST timeout/error)

`isValidAtom` del ad item es `true` si `vastState?.isLoading || !!vastState?.adsManager`. Si el VAST request falla (`AdsEvents.AdError` o `AdsEvents.Log`), `adsManagerReadyAtom` se pone en `true` pero `adsManagerInnerAtom` en `null`. Esto hace que `isLoading = false` y `adsManager = null`, por lo tanto `isValidAtom = false`. `RenderItem` retorna `null` para ese slide. `removeBadAdsAtomEffect` lo elimina de la lista.

[CODE: src/view/reels/atoms/vast.js:54-57]
[CODE: src/view/reels/atoms/vast.js:97-99]
[CODE: src/view/reels/atoms/items.js:163-166]
Coverage: ❌ Sin test

---

## EC-08 — `data-disable-msp-events="true"` en los players hijos

Cada player hijo tiene `data-disable-msp-events="true"`. Esto previene que los players hijos disparen eventos MSP globales (como `sourcechange`, `contentFirstPlay`, etc.) que podrían interferir entre instancias. El `internalEmitter.disableMspEvents` se evalúa en la emisión de cada evento.

[CODE: src/view/reels/components/video.js:104]
[CODE: src/api/player.jsx:204,258]
[CODE: src/events/index.js:11,24]
Coverage: ❌ Sin test

---

## EC-09 — El ad loop: después de completar, el ad se reproduce en loop indefinidamente

Una vez que el `AdsManager` interno recibe `Complete`, el ad loop es activado (`innerPlayer.loop = true`, `currentTime = 0`). En este estado, `play()` llama `innerPlayer.play()` directamente, y `pause()` llama `innerPlayer.pause()`. El ad no avanza al siguiente ni se desmonta — permanece en loop hasta que el usuario navegue.

[CODE: src/view/reels/utils/adsManager.js:52-62, 122-136]
Coverage: ❌ Sin test

---

## EC-10 — El volumen no se transfiere correctamente a un ad que aún no inicializó su container

Si el usuario cambia el volumen mientras un ad slot está en estado "loading" (antes de que el `AdsDisplayContainer` se inicialice), el volumen se guarda en `#state.volume`. Cuando el ad se inicializa y `#setNativeBindings()` se ejecuta, aplica `this.#innerPlayer.volume = this.#state.volume`.

[CODE: src/view/reels/utils/adsManager.js:94-98]
[CODE: src/view/reels/utils/adsManager.js:172-178]
Coverage: ❌ Sin test

---

## EC-11 — La fecha de metadata tiene locale hardcodeado a `es-CL`

`formatDate` en `useMetadata` usa `Intl.RelativeTimeFormat('es')` y `toLocaleDateString('es-CL', ...)`. Hay comentarios `FIXME: Fix Locale Date` en el código. En entornos donde `es-CL` no está disponible (algunos entornos Node/Playwright headless), el formato puede diferir del esperado o lanzar error.

[CODE: src/view/reels/components/videoControls/metadata/hooks/useMetadata.js:13-38]
Coverage: ❌ Sin test

---

## EC-12 — `OptionsMenu` y `LikeShareOptions` están comentados (incompletos)

En `VideoControls`, los componentes `OptionsMenu` y `LikeShareOptions` están importados pero comentados con nota `TODO: this component is incomplete`. No están en la UI actual.

[CODE: src/view/reels/components/videoControls/index.js:8-9]
[CODE: src/view/reels/components/videoControls/index.js:32-33]
Coverage: N/A — componentes no activos

---

## EC-13 — Race condition: player hijo desmontado antes de que su callback `data-loaded` se ejecute

Si el componente `Video` se desmonta (ítem sale del rango de memoria) antes de que el script tag dinámico invoque el callback `data-loaded`, el flag `mounted = false` previene que `setApi` sea llamado. El player hijo recibe `_player.destroy()` en su lugar.

[CODE: src/view/reels/components/video.js:110-150]
Coverage: ❌ Sin test

---

## EC-14 — El primer item del feed usa el volumen configurado en el player padre; los demás inician en volume=1

El primer ítem hereda el `volume` del player padre (si está entre 0 y 1). Los ítems con `index > 0` inician con `volume: 1` para no bloquear su inicialización (los browsers pueden bloquear autoplay de elementos con volumen > 0 si no hay interacción). El volumen correcto se aplica después via `volumeAtomEffect`.

[CODE: src/view/reels/components/video.js:55-65]
Coverage: ❌ Sin test
