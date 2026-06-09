# Next Episode — Business Rules

## Reglas de Timing

**BR-NEPI-001** — Threshold de incoming es 5 segundos adicionales al nextEpisodeTime

El evento `nextEpisodeIncoming` se emite cuando `timeRemaining <= nextEpisodeTime + 5`.
Si `nextEpisodeTime = 30`, el integrador recibe la notificación con 35 segundos restantes,
permitiendo preparar el siguiente episodio (prefetch, UI previa) antes de que la UI aparezca.

**BR-NEPI-002** — La UI de next episode aparece exactamente en `nextEpisodeTime` segundos antes del fin

La visibilidad de la UI (`shouldShow = true`) se activa cuando `timeRemaining <= nextEpisodeTime`.
El valor default de `nextEpisodeTime` es **30 segundos**. El integrador puede sobrescribirlo
vía `metadata.nextEpisodeTime` en la config del contenido o vía `nextEpisodeConfirmed.nextEpisodeTime`.

**BR-NEPI-003** — El countdown de auto-load dura exactamente 5 segundos (hardcoded)

Cuando la UI aparece con `hasEnoughTimeForAnimation = true` (más de 5s restantes), se inicia
un timer de **5000ms**. Si el usuario no interactúa, el siguiente episodio se carga automáticamente
al expirar el timer. Este valor no es configurable por el integrador.

**BR-NEPI-004** — Si el video tiene ≤ 5 segundos cuando aparece la UI, no hay countdown

Cuando `timeRemaining ≤ 5` en el momento en que `shouldShow` pasa a `true`,
`hasEnoughTimeForAnimation = false`. En este caso, no hay timer ni animación de progreso.
El auto-load ocurre cuando se dispara el evento `ended`.

## Reglas de Estado

**BR-NEPI-005** — El estado del módulo se resetea completamente en `sourcechange`

Al cambiar de contenido (incluyendo la transición al siguiente episodio), todos los estados
se resetean: `confirmedNextEpisode = null`, `keepWatching = false`, `incomingEventEmitted = false`,
`isLoading = false`, UI oculta. Cada nuevo contenido comienza con un estado limpio.

**BR-NEPI-006** — `nextEpisodeIncoming` se emite exactamente una vez por contenido

El evento se emite solo la primera vez que `shouldEmitIncomingEvent` pasa a `true` en un
contenido dado. No se re-emite aunque el usuario haga seek fuera y dentro del threshold.
Se vuelve a emitir en el siguiente contenido después del `sourcechange`.

**BR-NEPI-007** — `keepWatching` persiste hasta el siguiente `sourcechange`

Una vez que el integrador emite `nextEpisodeKeepWatching`, el flag permanece activo hasta
que ocurre un `sourcechange`. No se resetea por seek, pausa, o cualquier otra acción de usuario.
El integrador que quiera re-activar el auto-load en el mismo contenido debe hacer un `sourcechange`.

## Reglas de Activación

**BR-NEPI-008** — El módulo es exclusivo para VOD (`type: 'media'` o `type: 'episode'`)

Los tipos de contenido `'live'`, `'audio'` y `'dvr'` desactivan completamente el módulo.
No se emite `nextEpisodeIncoming`, no aparece UI, y no ocurre auto-load. Esta regla es
inmutable — no existe config para habilitar next episode en live/audio/DVR.

**BR-NEPI-009** — El módulo requiere que el contenido tenga un ID de siguiente episodio

El módulo se activa cuando `metadata.next` O `metadata.nextEpisodeId` tienen un valor, O
cuando el integrador emitió `nextEpisodeConfirmed` con un `{ id }` válido. Sin ID efectivo,
ninguna de las reglas de timing ni auto-load aplica.

**BR-NEPI-010** — `metadata.nextEpisodeOverride` bloquea la UI hasta recibir confirmación

Si `metadata.nextEpisodeOverride` tiene cualquier valor truthy, `requiresConfirmation = true`.
En ese estado: la UI no aparece, el auto-load no ocurre, y el botón "Watch Next" en UI
está deshabilitado. El único desbloqueo es recibir `nextEpisodeConfirmed` con un `{ id }` válido.

## Reglas de Carga

**BR-NEPI-011** — `nextEpisodeLoadRequested` siempre precede a `api.load()`

Independientemente de si la carga es manual (clic en Watch Next), automática (timer o ended),
o por evento externo (nextEpisodePlayNext), el evento `nextEpisodeLoadRequested` con el ID
del contenido **actual** se emite ANTES de llamar a `api.load()`. Esto permite al integrador
trackear qué contenido se estaba viendo cuando se inició la transición.

**BR-NEPI-012** — `api.load()` recibe el objeto `confirmedNextEpisode` completo cuando fue confirmado

Si el integrador emitió `nextEpisodeConfirmed({ id, type, customProp })`, `api.load()` recibe
`{ id, type, customProp }` (el objeto completo). Si no hubo confirmación, `api.load()` recibe
`{ id: effectiveNextEpisode, type }` donde `type` viene del contenido original.

**BR-NEPI-013** — `nextEpisodePlayNext` resetea `keepWatching` antes de cargar

Si el integrador emitió `nextEpisodeKeepWatching` y luego emite `nextEpisodePlayNext`,
`keepWatching` se resetea a `false` y la carga procede normalmente. `nextEpisodePlayNext`
tiene precedencia sobre `nextEpisodeKeepWatching`.

## Reglas de UI y Controles

**BR-NEPI-014** — Los controles del player se bloquean mientras la UI es visible

Cuando `nextEpisodeVisibleAtom = true`, las llamadas a `play()`, `pause()` y `set('currentTime', val)`
retornan `false` (override activo). El player no acepta comandos de reproducción externos
durante la pantalla de selección. Esto previene seek accidental durante el countdown.

**BR-NEPI-015** — El foco inicial es siempre en el botón "Watch Next" (index 0)

Cuando la UI aparece, el foco programático va al botón "Watch Next" (`focusedButton = 0`).
En TV con D-pad, ArrowLeft/Up alterna hacia "Watch Credits" y ArrowRight/Down vuelve a "Watch Next".
Escape actúa como "Watch Credits" (cierra la UI sin cargar el siguiente).

**BR-NEPI-016** — La UI no renderiza si el sistema i18n no está listo

El componente retorna `null` si `useTranslation('video').ready === false`. Esto es una limitación
de implementación, no una regla de negocio intencional, pero tiene el efecto de que la UI puede
no aparecer en entornos donde el bundle de traducciones no ha cargado.

## Reglas de la industria aplicables

**BR-NEPI-IND-001** — El countdown de 5 segundos es el estándar de la industria (Netflix, 2019)

Netflix probó 5, 10 y 15 segundos de countdown. Migró a 5s después de que los usuarios
se "condicionaron a esperar el autoplay". Lightning Player usa 5s, alineado con este estándar.
(Fuente: Hacker News, ex-Netflix developer, 2019)

**BR-NEPI-IND-002** — El autoplay debe ser opt-out, no opt-in (WCAG 1.4.2)

Según WCAG 2.1 AA, el usuario debe poder pausar o detener media que autoplay más de 3 segundos
con audio. El botón "Watch Credits" sirve como mecanismo de opt-out. Sin embargo, la
accesibilidad completa requiere que el countdown sea anunciado via ARIA (aria-live o role='timer').

**BR-NEPI-IND-003** — Las políticas de autoplay del browser aplican al siguiente episodio

La transición al siguiente episodio usa `api.load()` que internamente llama a `video.play()`.
En iOS Safari sin interacción previa o con Low Power Mode activo, este play puede ser bloqueado.
La plataforma debe manejar el estado "content loaded but not playing" como un escenario válido.

**BR-NEPI-IND-004** — Reusar el elemento `<video>` para transiciones consecutivas (Apple guideline)

Apple recomienda reusar un único elemento `<video>` cambiando su src en lugar de crear nuevos
elementos para contenido consecutivo. El patrón actual del player (sourcechange que reutiliza
el elemento existente) es correcto según esta recomendación.
