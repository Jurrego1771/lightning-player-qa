---
type: observability
feature: next-episode
version: "2.0"
status: draft
last_verified: 2026-04-26
---

# Observability — Next Episode

## Eventos públicos (los 5)

| Evento | Quién lo emite | Payload | Cuándo |
|---|---|---|---|
| `nextEpisodeIncoming` | Player | — | `timeRemaining <= nextEpisodeTime + 5`, una vez por contenido |
| `nextEpisodeConfirmed` | `updateNextEpisode(data)` | `data` pasado por el integrador | Cada vez que se llama |
| `nextEpisodePlayNext` | `playNext()` | — | Cada vez que se llama |
| `nextEpisodeKeepWatching` | `keepWatching()` | — | Cada vez que se llama |
| `nextEpisodeLoadRequested` | Player (click o autoload) | `currentId` (ID del contenido actual) | Justo antes de ejecutar `api.load()` |

[CODE: constants.cjs:81-86]

## Señales de transición real (post-load)

Para verificar que el siguiente contenido **realmente cargó**, usar en orden:

1. `sourcechange` — src del stream cambió
2. `metadataloaded` — metadata del nuevo contenido disponible
3. `ready` — player listo para el nuevo contenido

**No usar** `player.metadata` inmediatamente después de `playNext()` o autoload — puede contener datos del contenido anterior.

## API pública observable

```js
// Retornos de los métodos
player.updateNextEpisode(data)  // → undefined (no {success})
player.keepWatching()           // → {success: true|false}
player.playNext()               // → {success: true|false}
```

[CODE: src/api/player.jsx:285-320]

## Estado visible en video view

| Señal | Qué indica |
|---|---|
| Overlay `.next-episode` visible | UI activa (`nextEpisodeVisibleAtom === true`) |
| Clase `.next-episode--tv` | Modo TV con keyboard nav |
| Botón "Next" con clase de animación | Countdown de 5s activo |
| `player.play()` retorna `false` | Controles bloqueados (UI visible) |
| `player.pause()` retorna `false` | Controles bloqueados |
| `player.currentTime = val` retorna `false` | Seek bloqueado |

## Señales NO confiables

| Señal | Por qué no usarla |
|---|---|
| `player.metadata` justo después de `playNext()`/autoload | Puede tener datos del ep anterior [CODE: src/view/none/hooks/useNextEpisodeEvents.js:edge] |
| `nextEpisodePlayNext` como confirmación de carga | Solo confirma dispatch del evento, no que la carga terminó |
| `nextEpisodeKeepWatching` como confirmación de cancelación | Idem — solo dispatch |
| `updateNextEpisode()` retorno | Retorna `undefined`, no indica éxito |
| Overlay visible = `nextEpisodeIncoming` emitido | Los umbrales son distintos (incoming = tiempo+5, overlay = tiempo) |

## Observability interna (no testeable desde API pública)

- `incomingEventEmittedRef` — previene doble emisión de `nextEpisodeIncoming`
- `isLoadingRef` — previene cargas concurrentes
- `keepWatchingRef` — estado interno del flag
- `confirmedNextEpisode` — estado interno del ep confirmado
- Jotai atoms (`nextEpisodeVisibleAtom`, `hideControlsForNextEpisodeAtom`) — estado interno de UI

Estos no son observables desde tests sin acceder a internals. **No testear directamente.**

## Reglas de aserción

1. **Intención de transición** → usar `nextEpisodeIncoming`, `nextEpisodeLoadRequested`
2. **Transición real completada** → usar `sourcechange` + `metadataloaded`
3. **UI visible en video view** → selector del overlay, no solo evento
4. **Controles bloqueados** → llamar `player.play()` y verificar retorna `false`
5. **keepWatching efectivo** → verificar que `ended` no carga siguiente (esperar `ended` y confirmar que `sourcechange` no ocurre)

## Secuencia de eventos esperada (flujo normal, sin override)

### None view — happy path
```
nextEpisodeIncoming
  [usuario no interviene]
ended
nextEpisodeLoadRequested  ← carga inicia
sourcechange
metadataloaded
ready
```

### Video view — autoload por timer
```
nextEpisodeIncoming
  [overlay visible]
  [5s countdown]
nextEpisodeLoadRequested  ← timer expiró
sourcechange
metadataloaded
ready
```

### Video view — usuario hace click en Next
```
nextEpisodeIncoming
  [overlay visible]
  [usuario click]
nextEpisodeLoadRequested  ← click inmediato
sourcechange
metadataloaded
ready
```
