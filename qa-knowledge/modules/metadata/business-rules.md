# Metadata — Business Rules

Reglas derivadas del código fuente (`src/metadata/`), del comportamiento verificado del player y de estándares de la industria (W3C Media Session, HLS/DASH timed metadata).

## Reglas de exposición de metadata de contenido

**BR-META-001** — Resolución de campos por prioridad de fuentes
Cada campo de `player.metadata` se resuelve en cascada: `viewMetadata` → `metadata` → (`type` desde `originalType`) → `context[key]` → `metadata.preloadData`. El primer valor definido gana. Un campo sin valor en ninguna fuente se **omite** del objeto (no aparece como key con `null`/`undefined`).

**BR-META-002** — `player.metadata` nunca expone funciones de navegación
`goPrevItem` y `goNextItem` se recolectan internamente (para `nexttrack`/`previoustrack` de la Media Session) pero se eliminan del getter público y del payload de `metadatachanged` vía `omitPrevNext`. La metadata pública es solo datos.

**BR-META-003** — `metadatachanged` solo se emite ante un cambio real
Se emite únicamente si `playerReady` y el objeto metadata difiere del último emitido (`isEqual`). Re-renders que producen el mismo objeto NO emiten. Esto implica: un mismo item genera **a lo sumo 1** `metadatachanged`; un cambio de contenido (load de otro item) SÍ emite uno nuevo.

**BR-META-004** — Debounce de 100 ms en `metadatachanged`
La emisión se difiere 100 ms y se cancela si el metadata vuelve a cambiar antes, para absorber flushes síncronos de React. Las aserciones de conteo deben esperar más de 100 ms tras el último cambio.

## Reglas de duración

**BR-META-005** — `duration` no es fiable antes de `loadedmetadata`
Antes de que el browser dispare `loadedmetadata`, `player.duration` puede ser `0` o `NaN`. Mientras es `NaN`, la Media Session llama `setPositionState(null)` (no reporta posición). Cualquier lógica de duración debe esperar `loadedmetadata`/`durationchange`.

**BR-META-006** — `duration` es `Infinity` para live (no DVR-aware en la Media Session)
Para `type === 'live'`, la Media Session reporta `duration: Infinity`. La metadata no expone una ventana DVR finita; el rango DVR útil se deriva de `player.seekable`, no de `duration` ni del position state.

**BR-META-007** — Durante un ad, posición y duración se neutralizan
Mientras `ad.info` está presente, `setPositionState` recibe `position: 0` y `duration: 0`, y los handlers de seek hacen early return (no se permite scrub dentro de un ad linear).

## Reglas de timed metadata (live)

**BR-META-008** — `programdatetime` solo en HLS live que lo provee
El evento `programdatetime` se emite cuando un segmento HLS informa su PROGRAM-DATE-TIME. Streams sin ese tag no lo emiten; su ausencia es válida y no es un defecto.

**BR-META-009** — `metadata` (timed) proviene de cualquier fuente
El evento `metadata` transporta datos puntuales desde now-playing o desde ID3/`emsg` del stream HLS live. Su shape varía por tipo de tag; no debe asumirse una estructura fija.

## Reglas de now-playing (radio)

**BR-META-010** — Now-playing requiere Firestore real (no mockeable)
La actualización en tiempo real de canción (title/subtitle/poster) usa Firebase Firestore `onSnapshot` sobre la app nombrada `msp_meta`. No es testeable con `isolatedPlayer`; requiere red real (Firebase DEV + API nowplaying).

**BR-META-011** — `useID3Sync` define la estrategia de matching
Con `view.useID3Sync: true`, el matching de la canción usa ICY artist/title del stream HLS; con `false`, usa timestamps de Firestore. Una estación con stream `{type:'ICY'}` sin artist/title nunca matchea bajo `useID3Sync:true` y no actualiza `player.metadata`.

**BR-META-012** — Idempotencia de now-playing
Un POST con el mismo título devuelve `updated:false` y NO produce cambio en `player.metadata` (consistente con la dedup por `isEqual`).

**BR-META-013** — Fallo de backend de metadata no rompe la reproducción
Si Firestore/now-playing no está disponible, el player conserva la metadata estática de plataforma y sigue reproduciendo; no se emite `metadatachanged` con datos corruptos.

## Reglas de Media Session

**BR-META-014** — Media Session se actualiza en cada `load()` y en eventos de playback
La `MediaMetadata` (title/artist=subtitle/artwork) se reconstruye cuando cambia el contenido, y `setPositionState` se refresca en `play`, `pause`, `canplay`, `durationchange`, `timeupdate` y eventos de ads. Reset a `null` cuando no hay duración fiable.

**BR-META-015** — Media Session es singleton por documento (arbitraje multi-instancia)
Solo una instancia controla `navigator.mediaSession` a la vez. La instancia que entra en `playing`/`adsStarted`/`adsResumed` la toma; las demás ceden al recibir `msp:playing`/`msp:adsStarted`/`msp:adsResumed`. Una instancia solo limpia la sesión si la metadata actual es la suya.

**BR-META-016** — Action handlers condicionados al estado
`play`/`pause`/`stop` siempre disponibles; `seekbackward`/`seekforward`/`seekto` solo si `type !== 'live'`; `skipad` solo cuando hay ad reproduciéndose y skippable; `previoustrack`/`nexttrack` solo si existen `goPrevItem`/`goNextItem`.

**BR-META-017** — Artwork en 6 tamaños; blob/data sin redimensionar
Para pósters http(s) se generan 6 entradas (96–512 px) con params de resize del image proxy. Pósters `blob:`/`data:` no se redimensionan y el artwork queda vacío.

## Reglas de la industria aplicables

**BR-META-IND-001** — `setPositionState(null)` cuando no hay datos fiables (W3C / web.dev)
Resetear el position state a `null` cuando la duración es desconocida es la práctica recomendada y la que el player implementa. Evita que el SO muestre una barra de progreso incoherente.

**BR-META-IND-002** — live ⇒ `Infinity`, DVR ⇒ ventana seekable (hls.js / video.js / JWPlayer)
La convención de toda la industria es reportar `Infinity` para live infinito y derivar la ventana DVR de `seekable`/buffer. Los consumidores de metadata deben tratar live como caso aparte.

**BR-META-IND-003** — ID3/emsg y PROGRAM-DATE-TIME/EventStream no son uniformes (W3C Media Timed Events)
HLS (ID3 en .ts, PROGRAM-DATE-TIME) y DASH (emsg/CMAF, EventStream) difieren; no todos los backends soportan ambos. Los tests no deben exigir timed metadata idéntica entre protocolos.

**BR-META-IND-004** — Media Session degradable y dependiente de plataforma (MDN / PWA bugs)
La Media Session puede no existir (WebViews, headless) o comportarse distinto (iOS Safari <16.4 pixelaba artwork; PWAs iOS limitadas; Web Audio sin elemento `<audio>` pierde callbacks). El código debe feature-detect (`'mediaSession' in navigator`) y degradar — y lo hace.
