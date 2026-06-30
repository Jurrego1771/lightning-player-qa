# Reactions — Business Rules

Reglas derivadas del código fuente (`src/view/video/components/reactions/` y
`src/analytics/reactions/`) y de las prácticas de la industria para reacciones en vivo.

## Reglas de activación y visibilidad

**BR-REACT-001** — Solo contenido en vivo
La feature solo opera para `type === 'live'`. En VOD, audio, radio o podcast no se monta el plugin ni
se muestra UI (`plugins/index.js`: `liveReactions && isLive`; `utils.shouldShowReactions`).

**BR-REACT-002** — Triple condición de activación
El botón de reacciones aparece solo si se cumplen TODAS: (1) `options.liveReactions` truthy
(`1|'1'|true|'true'`), (2) la respuesta de plataforma incluye `reactions` config no nula, y (3) el
manager está registrado y `canShowReactions()` es true. Faltando cualquiera, la UI no aparece y no se
emite error (degradación silenciosa).

**BR-REACT-003** — Reacciones suspendidas durante ads y buffering
Mientras hay un ad break (`_adsStarted`) o el reproductor está en buffering (`_buffering`), las
reacciones se deshabilitan: el botón se oculta, el selector abierto se cierra y `canShowReactions()`
devuelve false. Se rehabilitan con `_adsAllAdsCompleted` / `_playing`.

**BR-REACT-004** — Visibilidad ligada a reproducción activa
El FAB solo se muestra cuando `isPlaying` es true. En pausa o pre-play el botón no aparece
(`shouldShowReactions`).

## Reglas de emisión y validación

**BR-REACT-005** — Allowlist doble de reacciones
Un `reactionCode` es válido solo si pertenece a la lista del sistema
(`heart`, `smile`, `surprised`, `confetti`, `claps`) Y, cuando el live define su propia lista, también
a esa. Cualquier código fuera de la intersección se rechaza con `VALIDATION_FAILED`.

**BR-REACT-006** — Saneamiento y rechazo de contenido sospechoso
El código se normaliza (trim, lowercase, solo `[a-z0-9-]`, máx 16 chars) y se rechaza si coincide con
patrones sospechosos (`<script`, `javascript:`, `on…=`, `data:`, `vbscript:`, entidades HTML) o si no
matchea `^[a-z]+$`. Las reacciones se tratan como entrada de usuario no confiable.

**BR-REACT-007** — Debounce de 250 ms
Múltiples emisiones en menos de 250 ms se colapsan: solo la última del intervalo se envía
(`ReactionScheduler`).

**BR-REACT-008** — Cuota de 10 reacciones por minuto
Un cliente no puede emitir más de 10 reacciones en una ventana deslizante de 60 s. La emisión que
excede devuelve `RATE_LIMITED` (categoría `user_error`) sin enviar al transporte.

**BR-REACT-009** — Errores de usuario no penalizan la fiabilidad
Los errores categorizados como `user_error` (validación, rate limit) NO incrementan el contador de
fallos consecutivos ni abren el circuit breaker.

**BR-REACT-010** — Circuit breaker de transporte
Tras 5 fallos consecutivos no-`user_error` el circuit breaker se abre y rechaza emisiones con
`CIRCUIT_BREAKER_OPEN` durante 30 s, tras los cuales se resetea. Errores `network_error` /
`temporary_error` se reintentan con backoff exponencial (`2^n × 1000ms`, hasta 3 intentos).

**BR-REACT-011** — Emisión nunca lanza al integrador
`emitReaction` siempre devuelve un objeto `{ success, ... }`; nunca propaga una excepción. La API
pública del plugin envuelve además cualquier error en `{ success: false, error: { code, message } }`.

**BR-REACT-012** — Evento público en emisión exitosa
Una emisión exitosa dispara el evento público `reactionEmitted` con
`{ reaction_code, player_id, playback_id, timestamp }` y un eco local optimista (`localReaction`).

## Reglas de visualización (overlay)

**BR-REACT-013** — Máximo de reacciones simultáneas
El overlay nunca muestra más de `maxVisibleReactions` (5) reacciones a la vez; las más antiguas se
descartan.

**BR-REACT-014** — Duración efímera
Cada reacción visible desaparece tras `displayDuration` (3000 ms). La animación flotante dura
`animationDuration` (2400 ms) ± `animationVariance` (600 ms).

**BR-REACT-015** — Deduplicación local/remoto
Una reacción no se renderiza dos veces: el dedup usa una `key` y una ventana de 5 s; un eco remoto que
coincide con una reacción local reciente (mismo `playerId`+`reactionCode`) reemplaza al local en lugar
de duplicarlo.

**BR-REACT-016** — Limpieza no bloqueante
La purga de reacciones expiradas y del registro de IDs procesados usa `requestIdleCallback` (con
fallback `setTimeout`) para no bloquear el hilo principal del reproductor.

## Reglas de la industria aplicables

**BR-REACT-IND-001** — Reacciones efímeras fuera del chat
Las reacciones flotan sobre el video y desaparecen, sin persistir en un panel de chat. Patrón alineado
con YouTube Live "timed reactions" y el "Emote Wall" de Twitch, que sacan los GIF/emotes fuera del
chat para no saturar la interfaz principal.

**BR-REACT-IND-002** — Set mínimo de emociones
La paleta debe cubrir el conjunto base de emociones (positiva / sorpresa / aplauso / cariño), en línea
con la recomendación de la industria 2025 de un set "no negociable" de reacciones.

**BR-REACT-IND-003** — Rate limiting en cliente (debounce + cuota)
Las reacciones en vivo deben limitarse en el cliente combinando debounce (ráfagas) y cuota por minuto
(volumen sostenido), con backoff exponencial ante errores/429, para no saturar el backend real-time.

**BR-REACT-IND-004** — Respeto a `prefers-reduced-motion` (gap actual)
Según WCAG/MDN, las animaciones no esenciales deben atenuarse cuando el usuario solicita movimiento
reducido. El reproductor actualmente NO aplica esta regla (ver `REACT-DEF-002`); se documenta como
regla objetivo, no como comportamiento implementado.

**BR-REACT-IND-005** — Optimistic UI con reconciliación
El feedback inmediato local antes de confirmación del servidor (optimistic UI) es el patrón esperado,
siempre que exista reconciliación/dedup para evitar duplicados cuando el evento vuelve del servidor.
