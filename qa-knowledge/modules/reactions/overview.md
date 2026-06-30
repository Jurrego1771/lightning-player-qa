# Reactions — Overview

## Qué hace

El módulo **Reactions** (reacciones en vivo / "live reactions") permite que un espectador de un
**live stream** envíe reacciones tipo emoji animado (heart, smile, surprised, confetti, claps) que
flotan sobre el video y se sincronizan en tiempo real con el resto de la audiencia vía Firebase /
Firestore. Es el equivalente Lightning Player a las "timed reactions" de YouTube Live o el "Emote
Wall" de Twitch.

Conceptualmente hay **dos capas** que el código separa físicamente:

| Capa | Ubicación | Responsabilidad |
|------|-----------|-----------------|
| **UI / View** (este módulo) | `src/view/video/components/reactions/` | botón flotante, selector, animación flotante, permisos, conexión al manager |
| **Manager / Analytics** | `src/analytics/reactions/` | `ReactionsManager` (lógica de emisión, validación, rate limit, circuit breaker, transporte Firebase). Cubierto también por el módulo `analytics-reactions`. |

Este documento cubre el módulo **`reactions`** como feature de UI de video end-to-end (botón →
selector → emisión → animación flotante → recepción remota), apoyándose en el manager como
dependencia interna.

La feature **solo aplica a contenido `type === 'live'`** y solo se monta si la plataforma envía
`liveReactions` truthy en la config del player (`options.liveReactions`) y la respuesta de plataforma
incluye un objeto `reactions` (`context.reactions`). Si `reactions` es `null`, el `ReactionsManager`
no recibe `reactionsConfig` y no hay reacciones soportadas.

## Archivos clave

| Archivo | Rol |
|---------|-----|
| `src/view/video/components/reactions/ReactionsModule.jsx` | Punto de montaje; compone Viewer + FloatingButton (ambos lazy). Montado en `container/index.jsx`. |
| `src/view/video/components/reactions/components/ReactionsFloatingButton.jsx` | Botón flotante (FAB) que abre el selector; gatea visibilidad con `shouldShowReactions`. |
| `src/view/video/components/reactions/components/ReactionsButton.jsx` | Variante de botón embebida en la barra de controles (polling propio del manager). |
| `src/view/video/components/reactions/components/ReactionsSelector.jsx` | Menú de reacciones (`role="menu"`), navegación por teclado horizontal/vertical. |
| `src/view/video/components/reactions/components/ReactionsViewer.jsx` | Overlay que renderiza y anima las reacciones flotantes (Web Animations API); dedup local/remoto. |
| `src/view/video/components/reactions/useReactionsManager.js` | Hook de conexión al manager con backoff exponencial (12 intentos). |
| `src/view/video/components/reactions/hooks/useReactionsPermission.js` | Estado `canShowReactions` reaccionando a `reactionsEnabled`/`reactionsDisabled`. |
| `src/view/video/components/reactions/utils/utils.js` | `shouldShowReactions`, `isEquivalentToFalse`, `normalizeTimestamp`, `generateReactionKey`. |
| `src/view/video/components/reactions/utils/reactionGifMap.js` | Mapa dinámico reactionCode → {icon, animation}; `getSupportedReactions`, `getReactionGif`. |
| `src/view/video/components/reactions/utils/preloader.js` | Preload de íconos estáticos y animados (Set de imágenes). |
| `src/analytics/reactions/core/ReactionsManager.js` | Manager registrado en el component registry como `'reactions'`; expone `emitReaction`, `getReactions`, `canShowReactions`, `getReactionsConfig`. |
| `src/analytics/reactions/index.jsx` | Plugin `LiveReactions`: instancia el manager, lo registra, expone API pública `emitReaction`/`getReactions`. |
| `src/analytics/reactions/core/ReactionValidator.js` | Valida reactionCode (patrón, longitud, XSS, lista del sistema + lista del live). |
| `src/analytics/reactions/core/ReactionScheduler.js` | Debounce (250ms) + rate limit (10/min). |
| `src/analytics/reactions/core/FirebaseTransport.js` | POST a `/api/live-stream/{playbackId}/reactions`. |
| `src/analytics/reactions/hooks/useReactionsListener.js` | Suscripción Firestore `live_reactions` para reacciones remotas. |

## Flujo de datos

```
PLATAFORMA (loadConfig)                       PLUGINS (index.js)
  options.liveReactions truthy  ───┐            liveReactions && isLive
  context.reactions = {config}     │              → registra LiveReactions plugin
                                   ▼
                         src/analytics/reactions/index.jsx (LiveReactions)
                           on(_ready) → new ReactionsManager(config)
                           register('reactions', manager)
                           expose({ emitReaction, getReactions })   ← API pública
                                   │
            ┌──────────────────────┴───────────────────────────┐
            ▼ (component registry 'reactions')                   ▼ (Firestore listener)
  useReactionsManager (backoff)                       useReactionsListener
   getComponent('reactions')                            collection 'live_reactions'
            │                                            sort timestamp desc, limit 50
            ▼                                                     │
  ReactionsFloatingButton                                        ▼
   shouldShowReactions(isLive, enabled,             manager.updateRealtimeReactions()
     !ads, !buffering, isPlaying, mgr, canShow)        emit('reactionsUpdate', reactions)
            │ click                                              │
            ▼                                                     ▼
  ReactionsSelector (menu)                            ReactionsViewer
   onReactionSelect(code)                              on('reactionsUpdate')  → remotos
            │                                          on('localReaction')    → optimista
            ▼                                          dedup (key + 5s window)
  manager.emitReaction(code)                                     │
   validate → rate-limit (debounce 250ms)                        ▼
   → FirebaseTransport.emit (POST)                     ReactionAnimation (WAAPI float-up)
   → internalEmitter.emit(_reactionEmitted)            displayDuration 3s, max 5 visibles
   → emit('localReaction')  (eco optimista)
```

## API pública

Expuesta vía `controls/methods` (objeto `player` / `api`):

| Método | Firma | Retorno |
|--------|-------|---------|
| `emitReaction(reactionCode)` | `async (string)` | `{ success: true, reactionCode }` o `{ success: false, error: { code, message } }`. **Nunca lanza** (se captura en el plugin). |
| `getReactions()` | `()` | `{ success: true, data: Reaction[] }` o `{ success: false, data: [], error }`. |

### Evento público

| Evento (`constants.cjs`) | Cuándo | Payload |
|--------------------------|--------|---------|
| `reactionEmitted` | usuario emite una reacción exitosamente | `{ reaction_code, player_id, playback_id, timestamp }` |

### Eventos internos del manager (EventEmitter, no en `constants.cjs`)

`reactionsUpdate`, `localReaction`, `reactionsEnabled`, `reactionsDisabled`, `reactionError`.
Consumidos por la UI vía `manager.on(...)`. No son API pública del player.

### Config de plataforma relevante

- `options.liveReactions` — flag de activación (acepta `1|'1'|true|'true'`).
- `context.reactions` — objeto `{ [reactionCode]: { icon, animation } }` (o `null`).
- `liveReactionsOrientation` — `'horizontal'` (default) | `'vertical'`.

## Interacciones con otros sistemas

- **events** — `internalEmitter` para `_ready`, `_adsStarted`, `_adsAllAdsCompleted`, `_buffering`,
  `_playing`; y emite `_reactionEmitted`, `_error`.
- **plugins / component registry** — `register('reactions', manager)` / `getComponent('reactions')`
  es el contrato de descubrimiento entre la capa UI y el manager.
- **ads** — reacciones se **deshabilitan durante ad breaks** (`_adsStarted` → `reactionsDisabled`).
- **metadata / firestore** — `useFirestore` con colección `live_reactions` (mismo backend Firestore
  que ID3/now-playing metadata).
- **i18n (video.json)** — clave `reactions.tooltip` (en/es/pt).
- **platform-config / loadConfig** — propaga `reactions` y `liveReactions` desde la respuesta de
  plataforma al contexto del player.
- **controls-api** — el botón embebido (`ReactionsButton`) vive junto a la barra de controles; el FAB
  ajusta su posición según `controlHeightAtom`/`showSkin`.
- **analytics-reactions** — módulo hermano que documenta la capa `src/analytics/reactions/` desde la
  perspectiva de tracking/manager. Este módulo y aquel comparten el `ReactionsManager`.
