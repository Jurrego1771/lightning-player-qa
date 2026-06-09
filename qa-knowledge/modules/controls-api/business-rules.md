# controls-api — Business Rules

## Reglas de ciclo de vida

**BR-CTRL-001** — Precondición de play() y pause()
`play()` y `pause()` lanzan `Error('Player is not ready. Wait for \`ready\` event')` si se llaman antes de que el evento `ready` sea emitido. El integrador DEBE esperar `ready` antes de invocar controles de reproducción. Esta verificación está en `state._ready` (no en readyState del video element).

**BR-CTRL-002** — `ready` es la señal única de readiness
El evento `ready` se emite cuando `_playerReady === true` Y `_viewReady === true`. `_playerReady` es seteado por el evento `canplay` del video element. `_viewReady` es seteado por el componente View. Ambas condiciones deben cumplirse.

**BR-CTRL-003** — `destroy()` es una operación irreversible
Después de llamar `player.destroy()`, el React tree está desmontado y los métodos expuestos en el prototype pueden lanzar errores o ser noops. Para reinicializar, usar `player.loadConfig(newOptions)` — que internamente llama `destroy()` antes de remontar.

**BR-CTRL-004** — `loadConfig()` previene carga concurrente
Si se llama `loadConfig()` mientras ya hay una carga en progreso, lanza `Error('Loading config while already loading...')`. Es responsabilidad del integrador serializar las llamadas a `loadConfig()`.

## Reglas de volumen y mute

**BR-CTRL-005** — Rango de volumen: [0, 1]
`player.volume` acepta solo valores en el rango cerrado `[0.0, 1.0]`. Valores fuera del rango son clampeados silenciosamente sin error ni warning. `0.0` = silencio total (pero no muted). `1.0` = volumen máximo.

**BR-CTRL-006** — muted es independiente de volume
`player.muted = true` silencia el audio pero no modifica el valor de `player.volume`. Al hacer unmute, el audio vuelve al volumen configurado. `volumechange` se emite tanto para cambios de volume como de muted.

## Reglas de seek

**BR-CTRL-007** — Seek en segundos absolutos
`player.currentTime = T` posiciona en `T` segundos desde el inicio del contenido. No es relativo al tiempo actual. Valores negativos clampean a `0`. Valores mayores a `duration` se comportan como `duration` (el video element lo gestiona).

**BR-CTRL-008** — Precisión de seek en HLS: ±2s
HLS snaps al keyframe más cercano. La precisión del seek depende del GOP size del stream. Tolerancia mínima en tests: ±2s. Streams con GOP largo (4-6s) pueden tener ±6s. Frame-accurate seeking requiere I-frames adicionales en el manifest (no presente en todos los streams).

**BR-CTRL-009** — Seek durante ad: no disponible
Durante un ad linear activo (`isPlayingAd() === true`), asignar `currentTime` no tiene efecto de seek sobre el contenido. El comando se delega al adsManager que puede ignorarlo. IMA SDK no expone seek para ads lineales.

## Reglas de calidad (level)

**BR-CTRL-010** — level = -1 activa ABR automático
`player.nextLevel = -1` o `player.level = -1` instruye a hls.js a activar el modo ABR automático. Cualquier número >= 0 fuerza ese nivel específico del array `player.levels`.

**BR-CTRL-011** — level y levels solo aplican en HLS
Las propiedades `level`, `levels`, `bandwidth`, `bitrate`, `nextLevel` son exclusivas de HLS (`sourceType === 'hls'`). Para contenido DASH (`sourceType === 'native'`), estas propiedades retornan `undefined` o `null`. No intentar control de calidad manual en DASH.

## Reglas de loop

**BR-CTRL-012** — loop es configuración de inicialización, no de runtime
`loop: true` en la configuración inicial activa la repetición automática. Asignar `player.loop = true` en runtime es un no-op conocido en v1.0.75. Si se necesita loop, configurar antes de inicializar el player.

## Reglas de autoplay

**BR-CTRL-013** — Autoplay fallido no es un estado de error permanente
Cuando `autoplay: true` y el browser rechaza la reproducción automática (política de autoplay), el player emite el evento `error` con el mensaje del rechazo y cambia `status` a `'pause'`. Este NO es un estado de error permanente. El player puede recibir `play()` posterior tras un user gesture exitosamente.

**BR-CTRL-014** — Muted autoplay es siempre permitido
`autoplay: true` con `muted: true` (o `volume: 0`) no es bloqueado por la política de autoplay de Chrome/browsers modernos. El muted autoplay con botón de unmute posterior es el patrón de UX estándar para autoplay confiable.

## Reglas de ads

**BR-CTRL-015** — adsManager tiene precedencia sobre playerHandler
En la cadena de delegación de `play()`, `pause()`, `get()`, `set()`: el adsManager es consultado primero. Si retorna un valor `!== false`, el comando no llega al playerHandler. Esto garantiza que el ad tenga control total durante su reproducción.

**BR-CTRL-016** — isPlayingAd() es el indicador oficial de ad linear activo
Para saber si hay un ad linear reproduciéndose, usar `player.isPlayingAd()`. No inferirlo del status ni de eventos. Un ad overlay no linear NO activa `isPlayingAd()` — solo ads lineales que pausan el contenido.

## Reglas de onNext / onPrev

**BR-CTRL-017** — onNext y onPrev deben ser funciones o null
Asignar a `player.onNext` o `player.onPrev` un valor que no sea función o null es ignorado silenciosamente (el setter valida con `typeof val === 'function'`). Si el valor es inválido, queda el valor anterior.

## Reglas de la industria aplicables

**BR-CTRL-IND-001** — HTMLMediaElement: play() devuelve Promise (desde 2019)
Todos los browsers modernos implementan `play()` como Promise. Integraciones que no hacen `await` o no manejan la promesa pierden errores de reproducción. Browsers pre-2019 (no relevantes en 2025) no devolvían Promise.

**BR-CTRL-IND-002** — NotAllowedError: excepción estándar para autoplay bloqueado
`NotAllowedError` es un `DOMException` (no `Error`) lanzado cuando el browser bloquea play() por política de autoplay. Es parte del estándar W3C. El player lo maneja internamente, pero los integradores que hacen catch deben saber que no es una instancia de `Error`.

**BR-CTRL-IND-003** — Estado de UI debe seguir al estado de la promesa, no a la llamada
El integrador no debe actualizar la UI de play/pause hasta que la promesa de `play()`/`pause()` resuelva o rechace. Mostrar un botón de "pausa" mientras play() aún está en vuelo es un anti-pattern UX documentado por Chrome DevRel.

**BR-CTRL-IND-004** — destroy() debe limpiar todos los event listeners
Después de destroy(), no deben quedar listeners activos en el DOM ni en el EventEmitter que referencien el player destruido. Memory leaks por listeners no removidos son la causa #1 de degradación de rendimiento en SPAs con player embebido.
