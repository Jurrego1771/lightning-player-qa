---
feature: next-episode
version: "2.1"
last_verified: 2026-04-26
spec: tests/integration/next-episode.spec.ts
status: pending-tests
---

# Next Episode

Auto-carga del siguiente episodio al aproximarse al final de un contenido. Implementado en las vistas `video`, `none`, `compact` y `podcast`. No aplica para `live`, `audio`, `dvr`.

## Vistas y comportamiento

| Vista | UI | Auto-Load | Controles bloqueados |
|---|---|---|---|
| `video` | Overlay + countdown 5s | Sí (timer) | Sí (play/pause/seek retornan `false`) |
| `none` | Sin UI | Sí (en `ended`) | No |
| `compact` / `podcast` | Botón `goNext()` simple | No | No |

## API pública

```js
player.updateNextEpisode(data)  // → undefined (no {success}). Emite nextEpisodeConfirmed.
player.keepWatching()           // → {success: true|false}. Previene autoload.
player.playNext()               // → {success: true|false}. Carga inmediatamente.
```

## Timing (valores exactos)

```
DEFAULT_NEXT_EPISODE_TIME  = 30s   (fallback si no se provee)
incomingThreshold          = nextEpisodeTime + 5s  (umbral para nextEpisodeIncoming)
AUTO_LOAD_DELAY            = 5s    (countdown video view antes de autoload)
hasEnoughTimeForAnimation  = timeRemaining > 5s  (overlay solo si hay tiempo)
```

## Eventos públicos (5)

| Evento | Cuándo | Payload |
|---|---|---|
| `nextEpisodeIncoming` | `timeRemaining <= nextEpisodeTime + 5`, una vez por contenido | — |
| `nextEpisodeConfirmed` | Cada llamada a `updateNextEpisode(data)` | `data` del integrador |
| `nextEpisodePlayNext` | Cada llamada a `playNext()` | — |
| `nextEpisodeKeepWatching` | Cada llamada a `keepWatching()` | — |
| `nextEpisodeLoadRequested` | Justo antes de ejecutar `api.load()` | `currentId` (ID del contenido actual) |

## Reglas de negocio clave

**BR-01 — nextEpisodeIncoming:** Emitido una sola vez por contenido (`incomingEventEmittedRef`). Se resetea en `sourcechange`. Condición: `timeRemaining <= nextEpisodeTime + 5 AND effectiveNextEpisode existe AND tipo no es live/audio/dvr`.

**BR-04 — Autoload none view:** Ocurre en `ended` si `effectiveNextEpisode` existe y `keepWatchingRef === false`.

**BR-05 — keepWatching():** Setea `keepWatchingRef = true`. Flag se resetea en `sourcechange`. Retorna `{success: false}` si el player está desmontado.

**BR-06 — playNext():** Resetea `keepWatchingRef = false` y ejecuta la carga inmediatamente. Ignora keepWatching.

**BR-07 — updateNextEpisode():** Retorna **`undefined`** (no `{success}`). Datos confirmados tienen prioridad sobre `metadata.next` para `effectiveNextEpisode`.

**BR-08 — nextEpisodeOverride:** Pasar `nextEpisodeId` O `nextEpisodeTime` en `loadConfig()` activa `nextEpisodeOverride = true`. Bloquea UI y autoload hasta que `updateNextEpisode(data)` sea llamado.

**BR-09 — Controles bloqueados (video view):** Mientras `nextEpisodeVisibleAtom === true`: `player.play()`, `player.pause()` y `player.currentTime = val` retornan `false`.

**BR-10 — Reset en sourcechange:** `confirmedNextEpisode`, `keepWatchingRef`, `incomingEventEmittedRef` e `isLoadingRef` se limpian.

**BR-12 — Concurrencia:** `isLoadingRef` previene cargas simultáneas.

## Señales confiables vs no confiables

**Para verificar transición completada** (en orden):
1. `nextEpisodeLoadRequested` → intención de carga
2. `sourcechange` → src cambió
3. `metadataloaded` → metadata del nuevo contenido disponible

**No usar:**
- `player.metadata` justo después de `playNext()`/autoload — puede tener datos del ep anterior
- `nextEpisodePlayNext` como confirmación de carga completada — solo confirma dispatch
- `updateNextEpisode()` retorno — siempre `undefined`
- `nextEpisodeIncoming` como proxy de overlay visible — umbrales distintos (+5 vs sin +5)

## Secuencias de eventos esperadas

**None view — happy path:**
```
nextEpisodeIncoming
ended
nextEpisodeLoadRequested → sourcechange → metadataloaded → ready
```

**Video view — autoload por timer:**
```
nextEpisodeIncoming → [overlay visible] → [5s countdown]
nextEpisodeLoadRequested → sourcechange → metadataloaded → ready
```

**Video view — click en "Watch Credits":**
```
nextEpisodeIncoming → [overlay visible] → [click Watch Credits]
overlay oculto, sourcechange NO ocurre, contenido continúa
```

## Edge cases clave

| EC | Regla |
|---|---|
| `updateNextEpisode()` retorno | Siempre `undefined` — no es señal de éxito |
| `nextEpisodeIncoming` no llega si overlay ya visible | Evento se emite una sola vez; si ya ocurrió, no llegará |
| Overlay no aparece con < 5s para animación | `hasEnoughTimeForAnimation = timeRemaining > 5` |
| Solo `nextEpisodeTime` en config | Activa `nextEpisodeOverride = true` aunque no haya `nextEpisodeId` |
| `keepWatching()` + `playNext()` | `playNext()` resetea el flag → carga ocurre igual |
| Reset en sourcechange | `keepWatching` del ep 1 no afecta al ep 2 |
| Carga concurrente | Segunda llamada ignorada silenciosamente |
| `none` view limita a `type === 'media'` o `'episode'` | Otros tipos no montan el componente |

## Anti-patrones

```typescript
// ❌ Esperar {success} de updateNextEpisode
const r = player.updateNextEpisode({})
expect(r.success).toBe(true)  // r === undefined, siempre falla

// ❌ player.metadata como señal de carga completada
const meta = await player.getMetadata()  // puede ser el ep anterior

// ✅ sourcechange + metadataloaded como señal de transición real
await player.waitForEvent('sourcechange')
await player.waitForEvent('metadataloaded')

// ❌ waitForTimeout para el timer de 5s
await page.waitForTimeout(6000)

// ✅ waitForEvent con timeout
await player.waitForEvent('nextEpisodeLoadRequested', { timeout: 10_000 })

// ❌ asumir nextEpisodeIncoming = overlay visible
// incoming: timeRemaining <= nextEpisodeTime + 5
// overlay:  timeRemaining <= nextEpisodeTime

// ❌ selector CSS interno
page.locator('.msp-next-episode--hidden')

// ✅ aria-label o visibilidad del contenedor
page.locator('[aria-label="Next episode"]')
```

## Prioridades de testing

**CRÍTICO:** TB-01 (contract API types), TB-03 (happy path none → autoload), TB-05 (playNext inmediato)
**ALTO:** TB-04 (keepWatching cancela), TB-06 (updateNextEpisode confirma ep), TB-07 (override bloquea)
**MEDIO:** TB-08 (tipos excluidos), TB-09 (reset en sourcechange)
**E2E:** TB-10 (overlay visible), TB-11 (controles bloqueados), TB-12 (click Créditos)
