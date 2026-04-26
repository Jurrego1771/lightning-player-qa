---
type: business-rules
feature: next-episode
version: "2.1"
status: draft
last_verified: 2026-04-26
---

# Business Rules — Next Episode

## Contexto: vistas que implementan la feature

| Vista | UI | Auto-Load | Controles bloqueados | Keyboard nav |
|---|---|---|---|---|
| `video` | Overlay con countdown, botones | Sí (timer 5s) | Sí (play/pause/seek) | Sí (TV mode) |
| `none` | Sin UI — solo hooks | Sí (en `ended`) | No | No |
| `compact` | Botón simple `goNext()` | No | No | No |
| `podcast` / `podcast2` | Botón simple `goNext()` | No | No | No |
| `reels` | No implementado | No | No | No |

[CODE: src/view/none/index.js:53, src/view/video/components/nextEpisode/index.jsx, src/view/compact/components/nextButton.jsx]

## API pública

```js
player.updateNextEpisode(data)  // Retorna undefined. Emite nextEpisodeConfirmed.
player.keepWatching()           // Retorna {success: true|false}. Previene autoload.
player.playNext()               // Retorna {success: true|false}. Carga inmediatamente.
```

[CODE: src/api/player.jsx:285-320]

## Timing (valores exactos)

```
DEFAULT_NEXT_EPISODE_TIME  = 30s  (fallback si no se provee nextEpisodeTime)
incomingThreshold          = nextEpisodeTime + 5s  (umbral para nextEpisodeIncoming)
AUTO_LOAD_DELAY            = 5s   (countdown en video view antes de autoload)
hasEnoughTimeForAnimation  = timeRemaining > 5s  (condición para mostrar overlay)
```

[CODE: src/view/none/hooks/useNextEpisodeEvents.js:15, src/view/video/components/nextEpisode/index.jsx:241]

---

## BR-01 — nextEpisodeIncoming: umbral y unicidad

`nextEpisodeIncoming` se emite cuando `timeRemaining <= nextEpisodeTime + 5` **y** `effectiveNextEpisode` existe **y** el tipo no es live/audio/dvr.

Se emite **una sola vez por contenido** (ref `incomingEventEmittedRef`). En `sourcechange` el ref se resetea, permitiendo re-emisión para el nuevo contenido.

[CODE: src/view/none/hooks/useNextEpisodeEvents.js:45-109]

## BR-02 — Umbral de visibilidad del overlay (video view)

El overlay es visible cuando:
1. `timeRemaining <= nextEpisodeTime`
2. `effectiveNextEpisode` existe
3. No es live/audio/dvr
4. El usuario no hizo click en "Ver créditos"
5. `nextEpisodeOverride === false` OR `confirmedNextEpisode` existe

El overlay NO se muestra si el umbral se alcanza con menos de 5 segundos disponibles para la animación (`hasEnoughTimeForAnimation = timeRemaining > 5`).

[CODE: src/view/video/hooks/useNextEpisodeTiming.js:16-47]

## BR-03 — Autoload en video view (timer de 5 segundos)

Cuando el overlay aparece y `hasEnoughTimeForAnimation === true`:
1. Animación de cuenta regresiva inicia
2. Timer de 5 segundos arranca
3. Si el usuario NO interactúa: `nextEpisodeLoadRequested` emitido + `api.load()` ejecutado
4. Si el usuario interactúa (click en botón o teclado): timer cancelado

[CODE: src/view/video/components/nextEpisode/index.jsx:221-241]

## BR-04 — Autoload en none view (en ended)

En none-view, la carga automática ocurre en `ended` si:
- `effectiveNextEpisode` existe
- `keepWatchingRef.current === false`

[CODE: src/view/none/hooks/useNextEpisodeEvents.js:133-148]

## BR-05 — keepWatching() cancela autoload

`keepWatching()` setea `keepWatchingRef.current = true`. Eso previene la carga automática en `ended`.

- Retorna `{success: true}` si el player está montado
- Retorna `{success: false}` si `_ref` es falsy
- El flag se resetea en `sourcechange`

[CODE: src/api/player.jsx:297-305, src/view/none/hooks/useNextEpisodeEvents.js:91-103]

## BR-06 — playNext() carga inmediatamente, ignorando keepWatching

`playNext()` resetea `keepWatchingRef.current = false` y ejecuta la carga inmediatamente, sin importar el estado actual de la UI ni el timer.

- Retorna `{success: true}` si el player está montado
- Retorna `{success: false}` si `_ref` es falsy

[CODE: src/api/player.jsx:312-320, src/view/none/hooks/useNextEpisodeEvents.js:125-132]

## BR-07 — updateNextEpisode() confirma o overridea el siguiente episodio

Emite `nextEpisodeConfirmed` con el payload recibido. Retorna **`undefined`** (no `{success}`).

El payload puede ser cualquier objeto con datos del episodio siguiente (id, type, etc.). Los datos confirmados tienen prioridad sobre `metadata.next` para determinar `effectiveNextEpisode`.

Falla silenciosamente si `_ref` es falsy.

[CODE: src/api/player.jsx:285-290]

## BR-08 — nextEpisodeOverride bloquea UI y autoload hasta confirmación

Si `loadConfig()` recibe `nextEpisodeId` **o** `nextEpisodeTime` no nulos:
- `nextEpisodeOverride = true` en metadata
- `requiresConfirmation = !!(nextEpisodeOverride && !confirmedNextEpisode?.id)`
- Mientras `requiresConfirmation === true`: overlay no se muestra, no hay autoload

El integrador debe llamar `updateNextEpisode(data)` para desbloquear.

[CODE: src/platform/loadConfig.js:343-356, src/view/video/hooks/useNextEpisodeTiming.js:16-18]

## BR-09 — Controles bloqueados durante overlay visible (solo video view)

Mientras `nextEpisodeVisibleAtom === true`:
- `player.play()` → retorna `false` (bloqueado)
- `player.pause()` → retorna `false` (bloqueado)
- `player.currentTime = val` → retorna `false` (seek bloqueado)
- Otros gets/sets → retornan `null` (permitidos)

[CODE: src/view/video/hooks/useNextEpisodeControls.js:8-33]

## BR-10 — Reset en sourcechange

En `sourcechange`, ambas vistas resetean:
- `confirmedNextEpisode = null`
- `keepWatchingRef.current = false`
- `incomingEventEmittedRef.current = false`
- `isLoadingRef.current = false`
- Video view además: todos los estados del componente (isVisible, isAnimating, userClicked, etc.)

[CODE: src/view/none/hooks/useNextEpisodeEvents.js:91-103, src/view/video/components/nextEpisode/index.jsx:170-189]

## BR-11 — Tipos de contenido excluidos

La feature NO aplica para `live`, `audio`, `dvr`. La condición `isLiveOrAudio` excluye estos tipos en ambas vistas.

None-view además solo activa la lógica para `type === 'media' || type === 'episode'`.

[CODE: src/view/none/hooks/useNextEpisodeEvents.js:17, 46; src/view/none/index.js:53]

## BR-12 — Protección contra cargas concurrentes

`isLoadingRef.current` previene cargas simultáneas. Si `isLoadingRef.current === true` cuando llega una nueva solicitud, la carga es ignorada.

[CODE: src/view/none/hooks/useNextEpisodeEvents.js:28, 60]

## BR-13 — nextEpisodeLoadRequested lleva el ID del contenido actual

Cuando la carga del siguiente episodio se inicia (por click o autoload), se emite `nextEpisodeLoadRequested` con el ID del contenido **actual** como payload (no del siguiente).

[CODE: src/view/video/hooks/useNextEpisodeEvents.js:21]
