# Events — Business Rules

## Reglas de suscripción a eventos

**BR-EVT-001** — Solo eventos en `Events.*` son aceptados por `player.on()`
El método `player.on(eventName, handler)` valida internamente que `eventName` esté en el objeto `Events` exportado por `constants.cjs`. Cualquier nombre que no esté en ese catálogo es descartado silenciosamente. No se arroja error, no se loguea warning. El integrador es responsable de usar los string values correctos.

**BR-EVT-002** — `player.off()` requiere la referencia exacta de la función
La eliminación de listeners usa igualdad de referencia estricta (`===`). Una función anónima pasada a `player.on()` no puede ser eliminada con `player.off()` porque cada expresión de función crea una referencia única. El integrador DEBE guardar la referencia en una variable antes de pasarla a `on()`.

**BR-EVT-003** — `player.once()` elimina el listener antes de invocarlo
Consistente con el comportamiento documentado de Node.js EventEmitter, `once()` elimina el handler del registro antes de ejecutarlo. Esto garantiza que incluso si el handler dispara el mismo evento de forma síncrona (reentrada), el listener no se invoca una segunda vez. El integrador puede confiar en que `once()` se ejecuta exactamente una vez.

**BR-EVT-004** — `player.on()` retorna `void` — no hay función de unsubscribe
La API actual no implementa el patrón "retornar unsubscribe". El integrador debe gestionar el ciclo de vida de sus listeners manualmente usando `player.off()` con la referencia correcta.

**BR-EVT-005** — Los eventos son sincrónos respecto al ciclo del EventEmitter
Cuando `internalEmitter.emit(event, payload)` es llamado, todos los handlers registrados para ese evento son invocados en el mismo call stack, en orden de registro. Los handlers no son llamados en un microtask ni en un setTimeout. Esto implica que si un handler es síncrono y lento, bloquea la ejecución del siguiente handler y del módulo que emitió el evento.

## Reglas de propagación por postMessage

**BR-EVT-006** — Todos los eventos públicos se propagan via `window.postMessage` con prefijo `msp:`
Cuando el player emite cualquier evento de `Events.*`, también envía:
```js
window.postMessage({ event: 'msp:' + eventName, id: uniqueId }, location.origin)
```
Este comportamiento es el contrato de integración para hosts de iframe. El host puede escuchar `window.addEventListener('message', handler)` y filtrar por `event.data.event.startsWith('msp:')`.

**BR-EVT-007** — El filtro de origen de postMessage usa `location.origin` estrictamente
Los mensajes recibidos desde un origen diferente a `location.origin` del player son ignorados completamente. Esto es una medida de seguridad contra inyección de eventos desde páginas no autorizadas. En integraciones cross-origin, el host debe usar el SDK de embedding oficial que gestiona el origen correctamente.

**BR-EVT-008** — Cada instancia del player tiene un `uniqueId` que previene el bucle de postMessage
Al inicializarse, cada instancia genera un ID único. Cuando recibe un mensaje postMessage, verifica que el `id` del mensaje no sea su propio `uniqueId`. Esto previene que una instancia procese sus propios eventos emitidos (bucle de retroalimentación). Los mensajes de otras instancias del mismo origen SÍ son procesados.

**BR-EVT-009** — `disableMspEvents=true` en la config suprime toda propagación de postMessage
Cuando esta opción está activa, el player emite eventos internamente y llama los handlers de `player.on()` normalmente, pero NO llama `window.postMessage()`. Esto es apropiado cuando el integrador gestiona la comunicación con el host por otro mecanismo o cuando no se necesita la integración iframe.

## Reglas de ciclo de vida

**BR-EVT-010** — `player.destroy()` elimina todos los listeners del emitter interno
La llamada a `destroy()` internamente ejecuta `internalEmitter.reset()` que llama `removeAllListeners()`. Después de `destroy()`, ningún evento subsecuente invocará handlers del player. Los listeners que el integrador haya podido registrar directamente en el DOM o en `window` (fuera de `player.on()`) NO son eliminados por `destroy()` — el integrador es responsable de limpiarlos.

**BR-EVT-011** — Los eventos one-shot (`ready`, `loaded`) no tienen mecanismo de replay
`ready` y `loaded` se emiten exactamente una vez. Si el integrador registra `player.on('ready', fn)` después de que el evento ya se emitió, `fn` nunca será invocada. El integrador debe registrar sus listeners ANTES de llamar `loadMSPlayer()` o leer el estado actual via getters (`player.status`, etc.) si necesita conocer el estado en lugar de reaccionar al cambio.

## Reglas del catálogo de eventos

**BR-EVT-012** — Los `InternalEvents.*` no son parte de la API pública
Los eventos `_ready`, `_adsLoaded`, `_playerLoaded`, `pluginsReady`, `controlsReady`, `_federationLoaded`, `_isCurrentMediaSession` son exclusivamente para coordinación interna del player. `player.on()` con cualquiera de estos nombres es un no-op porque no están en `Events.*`. El integrador no debe intentar escucharlos ni depender de su existencia.

**BR-EVT-013** — `fullscreenchange` está implementado solo para la vista de video
El evento `fullscreenchange` existe en el catálogo de `Events.*` y puede escucharse con `player.on()`, pero solo se emite en la vista de video. En la vista de radio, el evento nunca se emite aunque ocurra un cambio de fullscreen en el DOM. Esta es una limitación documentada con un TODO en el código fuente.

## Reglas de la industria aplicables

**BR-EVT-IND-001** — Los listeners deben limpiarse explícitamente antes de destruir la instancia del player
La práctica estándar de la industria (documentada en frameworks de UI como React, Vue, Angular) establece que cualquier suscripción a eventos externos debe ser limpiada en el hook de "cleanup" del componente. Para el Lightning Player:
- React: `useEffect(() => { player.on(e, fn); return () => player.off(e, fn); }, [])`
- Vue: `onMounted(() => player.on(e, fn)); onUnmounted(() => player.off(e, fn))`
- Vanilla JS: llamar `player.off()` explícitamente antes de `player.destroy()`

**BR-EVT-IND-002** — `player.off()` debe ser llamado con la referencia exacta de función — no con un wrapper
Un error común documentado en producción (react-player issue #616) es llamar `removeEventListener` con una función diferente (aunque con el mismo cuerpo) que la que se pasó a `addEventListener`. Para el Lightning Player, `player.off('event', fn)` donde `fn !== originalFn` es un no-op seguro pero no elimina el listener original. El integrador debe usar la misma referencia.

**BR-EVT-IND-003** — El contrato de eventos entre versiones del player debe estar versionado
La industria (Shaka Player, Video.js, hls.js) mantiene CHANGELOGs explícitos de cambios en eventos. Un cambio de string value en `Events.*` es un breaking change que debe ir en un major release y ser comunicado con deprecation period. Para el QA suite, cualquier cambio en `Events.*` debe ser detectado por el test de contrato.

**BR-EVT-IND-004** — Los eventos HTML5 Media son el subconjunto más portable de la API
Los eventos definidos en la especificación HTMLMediaElement (play, pause, playing, ended, seeking, seeked, timeupdate, volumechange, loadedmetadata, canplay, error) son los que todos los players de video implementan. Los integradores que quieran máxima portabilidad deben preferir estos eventos sobre los custom (contentFirstPlay, sourcechange, etc.).
