# pause-ad — Business Rules

## Reglas de activación

**BR-PAUSE-001** — El pause ad solo se activa después del primer play

`firstPlay` debe haber ocurrido antes de que cualquier evento `_pause` active el sistema.
Pausar el player antes de que el video haya iniciado (ej: autoplay bloqueado por el browser,
o el usuario hace pause inmediato antes del primer frame) no debe mostrar el pause ad.
Esto protege de activaciones indeseadas durante la inicialización del player.

**BR-PAUSE-002** — El pause ad NUNCA aparece durante un ad break lineal activo

Si `isAdsPlaying === true` (hay un pre-roll, mid-roll o post-roll activo), el pause ad
no se activa aunque el usuario pause la reproducción del ad. El bloqueo es doble:
en `onPause` (no inicia el fetch) y en `pauseAdShowAtom` (no renderiza aunque `started===true`).
Mostrar un pause ad durante un ad lineal sería doble publicidad simultánea — violación
de las políticas de la mayoría de ad servers y IAB guidelines.

**BR-PAUSE-003** — El pause ad no aparece en contenido terminado

Si `api.ended === true`, el sistema ignora el evento `_pause`. Pausar en el último
frame o después de que el contenido terminó no debe disparar el pause ad.

**BR-PAUSE-004** — No se hacen requests VAST concurrentes del pause ad

Si ya hay una request en progreso (`requestInProgress === true`), un segundo evento
`_pause` no lanza una segunda request. Esto previene condiciones de carrera si el
usuario pausa y reanuda rápidamente varias veces.

## Reglas de renderizado

**BR-PAUSE-005** — El pause ad es imagen estática — no video ni iframe

El componente renderiza únicamente un `<img src={staticResource[0]} />`. La URL de
la imagen se extrae del primer `staticResource` del creativo VAST (`nonLinear`,
`nonlinear`, `non-linear` o `companion`). Si el VAST no retorna un `staticResource`,
el pause ad no se renderiza — no es un error visible para el usuario.

**BR-PAUSE-006** — La impresión se trackea exactamente una vez por activación

Al primer render donde `vastConfig.impression` existe, se dispara un `fetch(url, {mode:'no-cors'})`
por cada pixel de impression. Este trackeo ocurre una sola vez — no se re-dispara si
el pause ad sigue visible. Duplicar el beacon de impresión inflaría los reportes del
ad server (mismo principio que BR-IMA-IND-003 para ads lineales).

**BR-PAUSE-007** — El click en el pause ad abre el clickThrough en nueva pestaña

Si `vastConfig.clickThrough` existe, el click sobre la imagen dispara:
1. Apertura de `clickThrough` en `_blank`
2. Fetch de cada URL en `clickThroughTracking` (pixels de tracking de click)
3. `api.play()` — el player reanuda automáticamente

No se pausa el tracking ni se bloquea el resume al hacer click.

**BR-PAUSE-008** — El tag_mobile tiene prioridad en dispositivos móviles

El sistema resuelve la URL del VAST según el dispositivo actual:
- Mobile/tablet → `tag_mobile` (si existe) o `tag` como fallback
- Desktop → `tag`
Si la plataforma configura ambos, los dispositivos móviles reciben un creativo
potencialmente diferente (distinto tamaño, formato o anunciante).

## Reglas de cierre

**BR-PAUSE-009** — El play del usuario cierra el pause ad inmediatamente

Al recibir `Events._play`, el sistema resetea el pause ad sin animación de espera.
El usuario nunca ve el pause ad mientras el video está reproduciéndose. Si el resume
ocurre mientras la animación de salida (500ms) está en curso, la animación se completa
pero el ad ya no bloquea la interacción.

**BR-PAUSE-010** — `close_button` controla cuándo aparece el botón X

| Valor | Comportamiento |
|-------|---------------|
| `-1` | X visible inmediatamente al aparecer el pause ad |
| `0` | Sin botón X; el usuario solo puede cerrar haciendo click en el overlay o resumiendo |
| `N > 0` | X aparece después de N segundos desde que el pause ad se muestra |

El botón X siempre llama `api.play()` al hacer click — no solo oculta el ad, sino que
reanuda la reproducción. Esto es consistente con el estándar IAB donde el resume es el
mecanismo de dismiss principal.

**BR-PAUSE-011** — `duration` controla el auto-cierre del pause ad

Si `duration > 0`, el pause ad se cierra automáticamente después de `duration` segundos
aunque el usuario no interactúe. Si `duration === 0`, el pause ad permanece hasta que
el usuario actúe (play, close button, click outside). `duration_mobile` aplica el mismo
comportamiento en dispositivos móviles.

## Reglas de la industria aplicables

**BR-PAUSE-IND-001** — El video debe seguir pausado mientras el pause ad está visible

El pause ad aprovecha el estado de pausa iniciado por el usuario — no lo provoca ni lo
extiende artificialmente. El contenido no reanuda solo mientras el ad está visible
(a menos que `duration` expire o el usuario interactúe). Es la diferencia definitoria
entre un pause ad y un interstitial.

**BR-PAUSE-IND-002** — El pause ad no debe aparecer en contenido live

El formato pause ad está diseñado para contenido VOD donde el usuario puede pausar el
stream. En live streaming, una "pausa" no detiene el ingest del servidor — el usuario
perdería contenido en vivo. La restricción de live no está implementada en código:
es responsabilidad de la configuración de plataforma no asignar ads con `pausead` a
contenido live.
Fuente: IAB CTV Ad Portfolio (diciembre 2025).

**BR-PAUSE-IND-003** — Sin delay de aparición vs. práctica de la industria

El player activa el pause ad inmediatamente al recibir el evento `_pause` (0s delay).
La industria usa delays de 3–10 segundos (YouTube: 10s exactos) para distinguir pausas
intencionales de pausas accidentales y mejorar la UX. Esta diferencia es un gap de UX
conocido respecto al estándar emergente. Ninguna business rule actual del player
implementa un delay configurable.

**BR-PAUSE-IND-004** — Frecuencia de aparición por sesión no está limitada en código

El player muestra el pause ad en cada pausa del usuario que cumpla las condiciones de
activación. Plataformas de referencia como Max limitan a 1 pause ad por sesión. Esta
restricción no existe en la implementación actual del Lightning Player — si el usuario
pausa múltiples veces en la misma sesión de reproducción, el pause ad aparece cada vez.
Es un gap conocido respecto a las mejores prácticas de UX.
