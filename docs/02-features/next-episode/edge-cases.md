---
type: edge-cases
feature: next-episode
version: "2.0"
status: draft
last_verified: 2026-04-26
---

# Edge Cases — Next Episode

## EC-01 — updateNextEpisode() retorna undefined, no {success}

`updateNextEpisode()` no tiene return statement. Retorna `undefined` siempre, incluso cuando el dispatch fue exitoso.

**Impacto en tests:** Un test que espere `{success: true}` fallará aunque el player funcione correctamente.

[CODE: src/api/player.jsx:285-290]
Coverage: ❌ Sin test

---

## EC-02 — nextEpisodeIncoming no emite si overlay ya visible

El evento se emite solo una vez por contenido (`incomingEventEmittedRef`). Si el test busca el evento después de que el overlay ya apareció, nunca llegará.

[CODE: src/view/none/hooks/useNextEpisodeEvents.js:106-109]
Coverage: ❌ Sin test

---

## EC-03 — Overlay no aparece si queda menos de 5s para la animación

`hasEnoughTimeForAnimation = timeRemaining > 5`. Si el contenido tiene menos de 5s restantes cuando alcanza el umbral de `nextEpisodeTime`, la UI no se muestra aunque la lógica de timing sea correcta.

**Impacto:** Si `nextEpisodeTime = 5` y el stream tiene exactamente 5s, el overlay nunca aparece por falta de tiempo para la animación.

[CODE: src/view/video/hooks/useNextEpisodeTiming.js:37-47]
Coverage: ❌ Sin test

---

## EC-04 — nextEpisodeOverride se setea con nextEpisodeTime también (no solo nextEpisodeId)

```js
hasNextEpisodeOverride = hasNextEpisodeIdOverride || (nextEpisodeTime !== undefined && nextEpisodeTime !== null && nextEpisodeTime !== '')
```

Pasar solo `nextEpisodeTime` en `loadConfig()` ya activa `nextEpisodeOverride = true`, lo que bloquea la UI hasta confirmación.

[CODE: src/platform/loadConfig.js:343-356]
Coverage: ❌ Sin test

---

## EC-05 — player.metadata puede tener datos del episodio anterior post-load

Inmediatamente después de `playNext()` o autoload, `player.metadata` puede contener datos del contenido anterior. Solo es confiable después de `metadataloaded`.

[CODE: behavior observado, src/view/none/hooks/useNextEpisodeEvents.js general]
Coverage: ❌ Sin test (es un anti-pattern a prevenir, no un caso a testear directamente)

---

## EC-06 — keepWatching() no previene playNext()

`playNext()` resetea `keepWatchingRef.current = false` antes de cargar. La secuencia `keepWatching()` → `playNext()` resulta en carga del siguiente episodio.

[CODE: src/view/none/hooks/useNextEpisodeEvents.js:125-132]
Coverage: ❌ Sin test

---

## EC-07 — Reset en sourcechange limpia keepWatching del episodio anterior

Si el usuario llama `keepWatching()` en el ep 1 y luego el contenido cambia (por otras razones), el flag se resetea. El ep 2 cargará automáticamente sin intervención.

[CODE: src/view/none/hooks/useNextEpisodeEvents.js:91-103]
Coverage: Parcial (TB-09 cubre el reset, no esta interacción específica)

---

## EC-08 — Carga concurrente ignorada (isLoadingRef)

Si `playNext()` se llama dos veces rápidamente, la segunda llamada es ignorada silenciosamente porque `isLoadingRef.current === true`.

[CODE: src/view/none/hooks/useNextEpisodeEvents.js:28, 60]
Coverage: ❌ Sin test

---

## EC-09 — None view solo activa para type='media' o type='episode'

Si el player está en none view pero el contenido es `type='live'`, `type='audio'`, o cualquier otro tipo no en `['media', 'episode']`, el componente NextEpisode no se monta y la feature no existe.

[CODE: src/view/none/index.js:53]
Coverage: ❌ Sin test explícito

---

## EC-10 — effectiveNextEpisode usa confirmedNextEpisode.id con prioridad

Si se llama `updateNextEpisode({id: 'custom'})` y `metadata.next = 'original'`, la carga usa `'custom'` (no `'original'`). El orden de prioridad es: `confirmedNextEpisode.id` > `nextEpisode` de metadata.

[CODE: src/view/none/hooks/useNextEpisodeEvents.js:41-43]
Coverage: Parcial (TB-06 lo cubre implícitamente)

---

## EC-11 — Loader de video view re-lanza errores

Si `api.load()` falla en video view, el error se loguea y se re-lanza. En none view, el loader también lanza si la API no está disponible. Estos errores no tienen manejo en el nivel de test — resultarán en el evento `error` del player.

[CODE: src/view/video/hooks/useNextEpisodeLoader.js:24-26, src/view/none/hooks/useNextEpisodeLoader.js:10]
Coverage: ❌ Sin test

---

## EC-12 — Botón "Next" deshabilitado si !nextEpisode

En video view, el botón "Next Episode" aparece visualmente pero tiene atributo `disabled` si `nextEpisode` (del contexto) es falsy. El overlay se muestra pero no es funcional.

[CODE: src/view/video/components/nextEpisode/index.jsx:281-290]
Coverage: ❌ Sin test

---

## EC-13 — updateNextEpisode() acepta string o object

El parámetro puede ser un string (ID) o un objeto completo. Ambos se pasan como payload del evento `nextEpisodeConfirmed`. Cuando se usa para la carga, el loader extrae `.id` y `.type` del confirmed data — si se pasa string, puede fallar la extracción de propiedades.

[CODE: src/api/player.jsx:285-290, src/view/video/hooks/useNextEpisodeLoader.js:14-20]
Coverage: ❌ Sin test
