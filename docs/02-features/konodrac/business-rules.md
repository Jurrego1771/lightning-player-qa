---
type: business-rules
feature: konodrac
version: "1.0"
status: draft
last_verified: 2026-05-05
---

# Business Rules — Konodrac Mark Collector API

---

## BR-01 — El tracker solo se activa si `enabled` es truthy Y `dataset` no está vacío

El plugin loader verifica `options?.metadata?.player?.tracking?.konodrac?.enabled`. Si no es truthy (`1`, `'1'`, `true`, `'true'`), el componente no se monta.

Adicionalmente, aunque el componente se monte, el tracker no llama a `init()` si `dataset` es falsy o vacío.

---

## BR-02 — El tracker no se activa en modo Reels

El plugin loader devuelve `{}` cuando detecta `view.type === 'reels'`, bloqueando todos los plugins.

---

## BR-03 — El tracker no se activa si hay error fatal al inicializar el player

Si `options.error` es truthy (error en carga de config de la plataforma), el plugin loader devuelve `{}`.

---

## BR-04 — `mloaded` se dispara una vez por contenido, al cargar

Se dispara cuando el player tiene el contenido listo para reproducir — mapeado a `Events._metadataloaded` o `Events._loaded` (confirmar con el equipo del player cuál es más apropiado para "el contenido se cargó en el player").

`secsPlayed` en este beacon siempre es `0`. `playerStatus` es `PAUSED`.

---

## BR-05 — `firstplay` se dispara exactamente una vez por contenido

Mapeado a `Events._contentFirstPlay`. Una vez que se dispara, el flag `_firstPlaySent = true` se pone true. No vuelve a dispararse hasta que el tracker sea destruido y reiniciado (nuevo contenido via `player.load()`).

---

## BR-06 — `secsPlayed` — state machine

`secsPlayed` es un acumulador de segundos reproducidos del contenido actual. Reglas:

```
Estado: { secsPlayed: number, lastTimestamp: number | null, isPlaying: boolean }

on mloaded:          secsPlayed = 0; isPlaying = false; lastTimestamp = null
on firstplay / play: isPlaying = true; lastTimestamp = Date.now()
on pause / endplay:  secsPlayed += elapsed(); isPlaying = false; lastTimestamp = null
on mhb:              secsPlayed += elapsed(); lastTimestamp = Date.now()  [solo si isPlaying]
on seek (LIVE/DVR):  secsPlayed = 0  [reset al cambiar de LIVE a CATCHUP]
on seek (→liveEdge): secsPlayed = 0  [reset al volver a LIVE]
on load():           secsPlayed = 0; isPlaying = false  [nuevo contenido]

elapsed() = Math.floor((Date.now() - lastTimestamp) / 1000)
```

Invariantes:
- `secsPlayed` nunca decrementa
- `secsPlayed` es entero (Math.floor, no float)
- `secsPlayed` nunca es negativo

---

## BR-07 — Transiciones de `pageType` en contenido LIVE/DVR

El `pageType` inicial viene del tipo de contenido (ver feature-spec.md tabla de mapeo).

Para contenido `live` o `dvr`:
- Al hacer seek (el usuario salta a una posición pasada): `pageType` cambia a `CATCHUP` y `secsPlayed` se resetea a `0`
- Al volver al live edge (posición ≈ duración o `player.currentTime ≥ player.duration - player.edge`): `pageType` vuelve a `LIVE` y `secsPlayed` se resetea a `0`

El beacon `seek` se envía con el nuevo `pageType` ya aplicado.

---

## BR-08 — `play` no se dispara en la primera reproducción (esa es `firstplay`)

El handler de `Events._play` verifica `_firstPlaySent`. Si es `false`, no hace nada (la primera reproducción ya la cubre `firstplay`). Solo dispara `play` en reproducciones subsiguientes.

---

## BR-09 — `mhb` solo corre mientras `isPlaying === true`

El `setInterval` de 50s está activo siempre, pero el handler verifica `isPlaying` antes de disparar el beacon. Si el player está pausado cuando el interval llega a 50s, no se envía beacon.

El interval se pausa/destruye en `dispose`.

---

## BR-10 — `mute` se detecta via `volumechange` cuando volume === 0

El handler de `Events._volumechange` recibe el nuevo volumen. Si `volume === 0` y el estado anterior no era muted, dispara beacon `event=mute`. No hay beacon de "unmute" en el contrato actual.

---

## BR-11 — `playerStatus` refleja el estado real en el momento del beacon

| Beacon | `playerStatus` |
|---|---|
| `mloaded` | `PAUSED` |
| `firstplay` | `PLAYING` |
| `play` | `PLAYING` |
| `pause` | `PAUSED` |
| `mhb` | `PLAYING` (solo se envía si isPlaying) |
| `seek` | depende del estado post-seek |
| `endplay` | `PAUSED` |
| `dispose` | depende del estado al destruir |
| `fullscreen` | depende del estado al momento |
| `mute` | depende del estado al momento |
| `error` | depende del estado al momento |

---

## BR-12 — `currentPosition` en segundos enteros

`player.currentTime` puede ser float. El tracker debe usar `Math.floor(player.currentTime)` para `currentPosition`.

---

## BR-13 — El tracker se reinicia en `player.load()` (cambio de contenido)

`KonodracAnalytics` extiende `Base` (MediastreamBaseComponent). Cuando las props cambian (nuevo contenido via `player.load()`):
1. `restart(false)` es llamado
2. `tracker.cleanup()` — limpia handlers, cancela interval de mhb, resetea estado
3. `tracker.init(newOptions)` en el siguiente tick — nueva sesión, `secsPlayed=0`, `_firstPlaySent=false`
4. `mloaded` se emite para el nuevo contenido

---

## BR-14 — `dispose` se envía al destruir el player

Se dispara en `componentWillUnmount` (o en `tracker.destroy()`), con `secsPlayed` acumulado hasta ese momento y `currentPosition` actual.

---

## BR-15 — El parámetro `uid` se omite completamente si el usuario es anónimo

No se incluye `uid=` en la URL. La ausencia del parámetro (no `uid=null` ni `uid=`) es la forma correcta de indicar usuario anónimo.

---

## BR-16 — TCF/GDPR: `gdpr=1` y `gdpr_consent=<TCString>` en todos los beacons

El tracker lee el TC String via `window.__tcfapi('getTCData', 2, callback)` al inicializarse. El string se cachea para no hacer llamadas repetidas.

Si `window.__tcfapi` no está disponible (usuario sin CMP), se envía `gdpr=0` y `gdpr_consent=` vacío — o se omiten según lo que indique Konodrac. En tests, mockear siempre con `gdpr=1`.
