# Next Episode — Overview

## Qué hace

El módulo **next-episode** implementa el flujo de auto-continuación de contenido en serie.
Cuando el contenido actual se aproxima a su fin, el player muestra una UI de transición que
permite al usuario saltar al siguiente episodio (con o sin countdown automático) o permanecer
viendo los créditos. Si el usuario no interactúa, el siguiente episodio se carga
automáticamente al terminar el countdown de 5 segundos.

Existe en dos variantes según el `view` del player:

- **`view: 'none'` (headless)** — `NextEpisode.js` monta solo el hook de eventos; no hay UI.
  La lógica de auto-carga se dispara directamente en el evento `ended`.
- **`view: 'video'` (UI completa)** — `nextEpisode/index.jsx` renderiza dos botones
  ("Watch Credits" / "Watch Next") con countdown animado de 5s y soporte de TV (D-pad).

## Archivos clave

| Archivo | Rol |
|---------|-----|
| `src/view/none/components/NextEpisode.js` | Componente headless: solo monta `useNextEpisodeEvents` sin UI |
| `src/view/none/hooks/useNextEpisodeEvents.js` | Lógica de autoload headless: escucha `ended`, `nextEpisodePlayNext`, `nextEpisodeKeepWatching` |
| `src/view/none/hooks/useNextEpisodeLoader.js` | Llama a `api.load()` (headless variant — default type `'media'`) |
| `src/view/video/components/nextEpisode/index.jsx` | Componente UI: botones, countdown, keyboard nav, TV skin |
| `src/view/video/components/nextEpisode/nextEpisode.scss` | Estilos: overlay bottom-right, animación `progress` 5s, TV overrides, responsive |
| `src/view/video/atoms/nextEpisodeControls.js` | Atom Jotai: `nextEpisodeVisibleAtom` + `hideControlsForNextEpisodeAtom` |
| `src/view/video/hooks/useNextEpisodeControls.js` | Override de controles: bloquea play/pause/seek cuando la UI está visible |
| `src/view/video/hooks/useNextEpisodeEvents.js` | Emite `nextEpisodeIncoming` y envuelve carga con `nextEpisodeLoadRequested` |
| `src/view/video/hooks/useNextEpisodeLoader.js` | Llama a `api.load()` (video variant — default type `'episode'`) |
| `src/view/video/hooks/useNextEpisodeTiming.js` | Calcula `shouldShow`, `hasEnoughTimeForAnimation`, `shouldEmitIncomingEvent`, `requiresConfirmation` |

## Flujo de datos

```
INIT CONFIG (id, type)
  └── metadata.next | metadata.nextEpisodeId   ← ID del siguiente episodio
  └── metadata.nextEpisodeTime                  ← segundos antes del fin donde aparece la UI (default: 30)
  └── metadata.nextEpisodeOverride              ← requiere confirmación externa antes de mostrar UI

PLAYBACK TICK (timeupdate)
  └── useNextEpisodeTiming
        ├── timeRemaining ≤ nextEpisodeTime + 5  →  shouldEmitIncomingEvent = true
        │     └── emit nextEpisodeIncoming(nextEpisodeId)   [una sola vez por contenido]
        └── timeRemaining ≤ nextEpisodeTime      →  shouldShow = true
              └── UI aparece (video view) O nada (headless)
              └── if hasEnoughTimeForAnimation (timeRemaining > 5):
                    setTimeout(5000) → auto-load si usuario no interactuó

EVENTOS EXTERNOS (del integrador)
  ├── nextEpisodeConfirmed(data)  → confirma episodio y custom data (puede override timing)
  ├── nextEpisodePlayNext         → carga inmediatamente, ignora keepWatching
  └── nextEpisodeKeepWatching     → previene auto-load al terminar el video

VIDEO ENDED
  ├── video view:  auto-load si !requiresConfirmation && !userClicked
  └── headless:    auto-load si !keepWatchingRef

LOAD
  └── api.load({ id, type, ...confirmedData })
        ├── emit nextEpisodeLoadRequested(currentId)  ← siempre antes de load
        └── sourcechange → reset completo de estado
```

## API pública

### Config de inicialización

El integrador puede pasar estos campos en la config de `loadMSPlayer()`:

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `nextEpisodeId` | `string` | ID del siguiente episodio (alternativa a `metadata.next`) |
| `nextEpisodeTime` | `number` | Segundos antes del fin donde aparece la UI (default: 30) |

Adicionalmente, el objeto de metadata del contenido puede contener:

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `metadata.next` | `string` | ID del siguiente episodio |
| `metadata.nextEpisodeId` | `string` | Alias de `metadata.next` |
| `metadata.nextEpisodeTime` | `number` | Tiempo de aparición de UI en segundos |
| `metadata.nextEpisodeOverride` | `any` | Si está definido, requiere confirmación externa antes de mostrar UI |

### Eventos públicos emitidos (player → integrador)

| Evento | Payload | Cuándo se emite |
|--------|---------|-----------------|
| `nextEpisodeIncoming` | `string` (next episode id) | 5 segundos ANTES de que aparezca la UI (threshold: `nextEpisodeTime + 5`) |
| `nextEpisodeLoadRequested` | `string` (current content id) | Justo antes de llamar a `api.load()`, tanto por clic como por auto-load |

### Eventos externos (integrador → player)

| Evento | Payload | Efecto |
|--------|---------|--------|
| `nextEpisodeConfirmed` | `string \| { id, type?, nextEpisodeTime?, ...rest }` | Confirma (y opcionalmente reemplaza) el siguiente episodio con datos custom |
| `nextEpisodePlayNext` | — | Carga el siguiente episodio inmediatamente, cancela keepWatching |
| `nextEpisodeKeepWatching` | — | Previene el auto-load al finalizar el video actual |

### Métodos de player fixture (QA harness)

| Método | Descripción |
|--------|-------------|
| `player.updateNextEpisode(data)` | Dispara `nextEpisodeConfirmed` con `data` |
| `player.playNext()` | Dispara `nextEpisodePlayNext` |
| `player.keepWatching()` | Dispara `nextEpisodeKeepWatching` |

## Interacciones con otros sistemas

| Sistema | Tipo | Descripción |
|---------|------|-------------|
| `playback-core` | Dependencia | Se suscribe a `ended`, `timeupdate` (via hooks de duration/currentTime) y `sourcechange` |
| `controls-api` | Override | Bloquea play, pause y seek (`currentTime`) cuando la UI del next episode es visible |
| `events` | Consumidor/Productor | Lee de `internalEmitter` para eventos públicos y los traduce a acciones de UI |
| `metadata` | Fuente de datos | Lee `metadata.next`, `metadata.nextEpisodeTime`, `metadata.nextEpisodeOverride` del contexto |
| `api.load()` | Transición | La carga del siguiente episodio es una llamada a `api.load()` que genera un `sourcechange` completo |
| `i18n` | UI | Claves de traducción `nextEpisode.watchCredits` y `nextEpisode.nextEpisode` |
| `jotai atoms` | Estado UI | `nextEpisodeVisibleAtom` → `hideControlsForNextEpisodeAtom` oculta la barra de controles |

## Tipos de contenido válidos

El módulo solo funciona para estos tipos: `'media'`, `'episode'`, `'live'`, `'audio'`, `'dvr'`.

**Nota crítica:** Los tipos `'live'`, `'audio'` y `'dvr'` tienen `isLiveOrAudio = true`, lo que
**desactiva completamente** el next episode (no se muestra UI, no se emiten eventos de incoming).
El módulo es exclusivo para VOD (`'media'` / `'episode'`).

## Diferencias clave entre headless y video view

| Aspecto | `view: 'none'` (headless) | `view: 'video'` (UI completa) |
|---------|--------------------------|-------------------------------|
| UI | Ninguna | Botones + countdown 5s + TV skin |
| Auto-load trigger | Al evento `ended` (sin delay) | Timer 5s + evento `ended` |
| keepWatching | Soportado (ref booleano) | Soportado (mismo mecanismo) |
| Default type | `'media'` | `'episode'` |
| Control override | No aplica | Sí (bloquea play/pause/seek) |
| Keyboard nav | No aplica | Sí (ArrowLeft/Right, Enter, Escape) |
| TV skin | No aplica | Sí (clase `next-episode--tv`) |
