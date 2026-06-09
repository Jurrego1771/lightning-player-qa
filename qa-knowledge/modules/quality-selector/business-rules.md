# Quality Selector — Business Rules

Reglas de negocio derivadas del código fuente del Lightning Player (`src/player/handler/{hls,dash}/handler.js`, `src/player/base.js`, `src/view/video/atoms/level.js`) y de estándares/práctica de la industria de streaming.

## Reglas del modelo de niveles

**BR-QUAL-001** — `level = -1` significa ABR automático
El valor `-1` en `player.level` (y `player.nextLevel`) indica que el motor de streaming decide
el nivel de calidad automáticamente según bandwidth/buffer/viewport. Es el estado por defecto al
cargar cualquier source. `player.autoLevelEnabled` es `true` en este estado.

**BR-QUAL-002** — Los niveles son 0-indexados contra `player.levels`
Cualquier `player.level >= 0` es un índice exacto dentro del array `player.levels`. `level = 0`
es el primer elemento del array. El índice válido máximo es `player.levels.length - 1`.

**BR-QUAL-003** — Fijar un nivel manual deshabilita ABR (override total)
Asignar `player.level = N` (con `N >= 0`) deshabilita el ABR (`autoLevelEnabled` pasa a `false`)
y el player mantiene ese nivel hasta que el usuario vuelva a Auto. El motor NO reajusta la calidad
automáticamente mientras haya un nivel fijo, aunque la red cambie.

**BR-QUAL-004** — Volver a `level = -1` re-habilita ABR
Asignar `player.level = -1` (o `player.nextLevel = -1`) re-habilita el ABR automático. En HLS se
emite un `levelchange` sintético para informar a la UI del cambio manual→auto. En DASH se hace
`updateSettings({streaming:{abr:{autoSwitchBitrate:{video:true}}}})`.

**BR-QUAL-005** — `nextLevel` precede a `level` en una transición
`player.nextLevel` es el nivel solicitado/pendiente y cambia de inmediato al asignar un nivel.
`player.level` (nivel realmente reproduciéndose) sólo adopta ese valor tras el siguiente switch,
señalizado por el evento `levelchanged`. Durante la transición pueden diferir.

**BR-QUAL-006** — `player.levels` está disponible sólo después del manifest parseado
El array de niveles está vacío hasta que el manifest se parsea (evento `ready` / primer `canplay`).
Leer `player.levels` antes de ese momento devuelve `[]`.

## Reglas de eventos

**BR-QUAL-007** — `levelchange` precede a `levelchanged`
`levelchange` se emite cuando se solicita un cambio de nivel (antes de que el nuevo nivel esté en
el buffer reproduciéndose). `levelchanged` se emite cuando el nuevo nivel ya se reproduce. El orden
canónico es `levelchange` → `levelchanged`. Ambos llevan payload `level: number`.

**BR-QUAL-008** — Los eventos de calidad son idénticos en HLS y DASH
Ambos protocolos emiten `levelchange`/`levelchanged` con la misma semántica. El consumidor de la
API no necesita conocer el protocolo subyacente. (HLS los deriva de `LEVEL_SWITCHING`/`LEVEL_SWITCHED`;
DASH de `QUALITY_CHANGE_REQUESTED`/`QUALITY_CHANGE_RENDERED`.)

## Reglas de telemetría

**BR-QUAL-009** — `bandwidth` y `bitrate` se expresan en bits por segundo
`player.bandwidth` (ancho de banda estimado) y `player.bitrate` (bitrate del nivel activo) están
siempre en bits/seg. HLS lee `hls.bandwidthEstimate` directo; DASH multiplica `getAverageThroughput`
(bytes/seg) por 8. La conversión a kbps es sólo para presentación en UI.

**BR-QUAL-010** — La telemetría puede ser `null` cuando no hay dato
`player.bandwidth` es `null` hasta que el estimador converge (varios segmentos descargados).
`player.bitrate` es `null` en DASH cuando `level === -1` o el índice está fuera de rango. Los
getters devuelven `null` explícito (no `NaN`/`undefined`); el consumidor debe manejar `null`.

**BR-QUAL-011** — `droppedFrames` es un contador acumulativo no decreciente
`player.droppedFrames` cuenta los frames de video descartados desde el inicio de la reproducción.
Es monotónicamente no decreciente durante una sesión de reproducción.

## Reglas de cobertura de protocolos

**BR-QUAL-012** — La API de calidad aplica tanto a HLS (hls.js) como a DASH (dash.js 5.1.1)
`level`/`levels`/`nextLevel`/`autoLevelEnabled`/`bandwidth`/`bitrate`/`droppedFrames` funcionan en
ambos protocolos con contrato uniforme. La afirmación legacy de que "DASH no soporta calidad/ABR"
está obsoleta y es incorrecta (ver QUAL-LEARN-001).

**BR-QUAL-013** — Índice inválido: HLS lanza, DASH es no-op (inconsistencia conocida)
`player.level = N` con `N >= levels.length` (y `N !== -1`) lanza `Error('Invalid level')` en HLS
pero se ignora silenciosamente en DASH. El integrador debe validar el índice contra
`player.levels.length` antes de asignar (ver QUAL-DEF-002).

## Reglas de la industria aplicables

**BR-QUAL-IND-001** — La selección manual de calidad anula el ABR por completo
Estándar de la industria (Dolby OptiView, dash.js, hls.js, Mux): elegir una calidad específica
overrule el algoritmo de ABR. El Lightning Player cumple esta convención. El usuario recupera ABR
sólo eligiendo explícitamente "Auto".

**BR-QUAL-IND-002** — Usar la variante no destructiva al cambiar de nivel
hls.js distingue `currentLevel` (flush de buffer = stall inmediato) de `nextLevel`/`loadLevel`
(no destructivo). La práctica recomendada para cambios manuales es la no destructiva. El player usa
`nextLevel + loadLevel`, evitando el rebuffer agresivo (ver QUAL-LEARN-004).

**BR-QUAL-IND-003** — Usar la API de representación moderna de dash.js v5
dash.js v5 removió `setQualityFor()`. La API vigente es `setRepresentationForTypeByIndex` /
`setRepresentationForTypeById` + `updateSettings({streaming:{abr:{autoSwitchBitrate}}})`. El player
usa la API moderna y NO debe regresar a `setQualityFor()` (ver QUAL-LEARN-005).

**BR-QUAL-IND-004** — `capLevelToPlayerSize` limita el nivel máximo al tamaño del reproductor
Práctica de ahorro de ancho de banda: no servir resoluciones mayores que el viewport del player.
El Lightning Player activa `capLevelToPlayerSize: true` en HLS. El nivel máximo seleccionable por
ABR queda acotado al tamaño visible del reproductor.

**BR-QUAL-IND-005** — El selector de calidad UI antepone "Auto" y ordena de mayor a menor
Convención de UX OTT: la primera opción del selector es "Auto" (ABR), seguida de las resoluciones
en orden descendente. El Lightning Player sigue esta convención en `LevelsAccordionItem`.
