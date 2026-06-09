# Plugins — Business Rules

## Reglas de carga y activación

**BR-PLUG-001** — Carga condicional por configuración
Un plugin se monta únicamente si su condición de activación en `load(options)` se cumple. La habilitación
de trackers se evalúa por truthiness canónica contra el conjunto `[1, '1', true, 'true']`; cualquier otro
valor se considera deshabilitado.

**BR-PLUG-002** — Plugins siempre presentes
`Federation` y `PlayingMetadata` se montan siempre, salvo que exista un error fatal previo
(`options.error`) o que la vista sea `reels`.

**BR-PLUG-003** — Corte por error fatal
Si `options.error` está presente, `load()` retorna `{}` y no se monta ningún plugin. Ningún SDK externo
ni beacon de analytics debe iniciarse en estado de error fatal.

**BR-PLUG-004** — Aislamiento de reels
En vista `reels`, `load()` retorna `{}`. Cada instancia de reproducción interna del reels carga sus propios
plugins de forma independiente; no hay plugins globales compartidos.

**BR-PLUG-005** — Carga diferida (lazy)
Todo plugin se carga mediante `import()` dinámico (`React.lazy`). El código del plugin no debe descargarse
si su condición de activación no se cumple.

## Reglas de readiness y reproducción

**BR-PLUG-006** — La reproducción está gateada por la readiness de todos los plugins
El elemento de video no se monta hasta que `pluginsReady()` sea `true`, lo cual requiere que todos los
componentes registrados retornen `getIsReady() === true`. Un plugin no listo retrasa o impide el arranque.

**BR-PLUG-007** — Un plugin que falla en su readiness no debe bloquear permanentemente
Si la promesa de `isReady()` se rechaza, el plugin igualmente se marca como listo (`finally`) para no
colgar la reproducción. (Limitación conocida: una promesa que nunca se asienta sí bloquea — ver
PLUG-DEF-001.)

**BR-PLUG-008** — Aislamiento de fallos entre plugins
El fallo de un plugin (CDN caído, error de inicialización) no debe impedir el montaje ni la operación de
los demás plugins, ni romper la reproducción. La ausencia de un plugin de analytics es siempre degradación
con gracia, nunca error fatal.

## Reglas de prioridad y exclusión mutua

**BR-PLUG-009** — Prioridad de ad insertion
Google DAI tiene prioridad sobre MediaTailor DAI. `loadConfig` no debe configurar MediaTailor cuando
Google DAI está activo, evitando doble inserción de anuncios.

**BR-PLUG-010** — SGAI requiere configuración completa
`GoogleSGAI` solo se monta si existen `networkCode` y `customAssetKey` y `enabled !== false`. Config parcial
no activa el plugin.

**BR-PLUG-011** — LiveReactions solo en live
`LiveReactions` solo se monta cuando el contenido es `type === 'live'`, además del flag habilitado.

## Reglas de privacidad

**BR-PLUG-012** — Do-Not-Track desactiva métricas propias y Google
Con `dnt` activo, `StreamMetrics` y `GoogleTracker` no se montan. Los demás trackers (Youbora, Comscore,
Konodrac) se rigen por sus propios flags `enabled` y no son desactivados por `dnt` (ver PLUG-DEF-005).

## Reglas de ciclo de vida

**BR-PLUG-013** — El set de plugins se decide una sola vez
El conjunto de plugins se determina en la carga inicial con la config y el contenido inicial. No se
reevalúa ante cambios de contenido; los plugins que necesiten datos por-contenido deben suscribirse a
eventos internamente, no leer `options.metadata.*` al cargar.

**BR-PLUG-014** — Cleanup en desmontaje
Al desmontarse, un plugin marca `__destroyed` e invoca `restart(true)`. Cada plugin es responsable de
liberar sus listeners y recursos de SDK en `restart(true)` (no hay dispose centralizado garantizado).

## Reglas de la industria aplicables

**BR-PLUG-IND-001** — Degradación con gracia ante fallo de chunk
La práctica de plugin architectures en producción exige que un fallo de descarga de un módulo opcional
degrade con gracia sin romper la aplicación. (Fuente: freecodecamp, Vidstack.) Aplica a Lightning: un
chunk de plugin no descargable no debe romper el player.

**BR-PLUG-IND-002** — Dispose determinístico que limpia listeners y referencias
Video.js define `dispose()` como único método soportado para remover un player de DOM y memoria, limpiando
automáticamente listeners y referencias de cada plugin. Lightning debería garantizar equivalencia funcional
en `restart(true)` para evitar memory leaks. (Fuente: docs.videojs.com/plugin.)

**BR-PLUG-IND-003** — Inicialización con timeout y fallback
La industria (Flutter video_player, Angular youtube-player) documenta que la inicialización de plugins debe
tener timeout y manejar el caso de disposal-durante-init para evitar cuelgues y leaks. Aplica directamente
a PLUG-RISK-001.

**BR-PLUG-IND-004** — Carga lazy del motor solo cuando se necesita
La práctica recomendada (Vidstack, Squarespace Engineering) es cargar HLS.js/dash.js y módulos satélite
solo cuando el contenido o la config lo requieren, manteniendo el bundle base liviano. Lightning lo cumple
vía `React.lazy` condicional en `index.js`.
