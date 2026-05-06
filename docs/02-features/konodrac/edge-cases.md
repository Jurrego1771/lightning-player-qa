---
type: edge-cases
feature: konodrac
version: "1.0"
status: draft
last_verified: 2026-05-05
---

# Edge Cases — Konodrac Mark Collector API

## EC-01 — `enabled: false` en config — tracker no se monta

El plugin loader chequea `enabled` antes de montar el componente. Si `false`, no hay `KonodracAnalytics` en el árbol React y no se emiten beacons.

Coverage: ✅ Test A2

---

## EC-02 — Config sin `dataset` — tracker init no ejecuta

El componente se monta pero `tracker.init()` retorna sin efecto si `dataset` es falsy o vacío.

Coverage: ✅ Test A1 (implicit — sin config Konodrac)

---

## EC-03 — `firstplay` solo se dispara una vez por contenido

Si el usuario pausa y reproduce varias veces en la misma sesión de contenido, `firstplay` se emite solo en la primera. Las siguientes reproduccciones emiten `play`.

Coverage: ✅ Tests B3, B4

---

## EC-04 — `secsPlayed` no decrementa aunque se haga seek backward (VOD)

En VOD, un seek hacia atrás no resetea `secsPlayed`. El acumulador refleja tiempo real reproducido, no posición.

Ejemplo: play 30s → seek a 0s → play 10s → secsPlayed = 40 (no 10).

Coverage: ✅ Test D4

---

## EC-05 — `secsPlayed` se resetea en seek de LIVE → CATCHUP

En contenido LIVE/DVR, seek a posición pasada cambia `pageType` a `CATCHUP` y resetea `secsPlayed = 0`.

Coverage: ✅ Test D6, E3

---

## EC-06 — `secsPlayed` se resetea al volver de CATCHUP → LIVE

Cuando el usuario alcanza el live edge desde CATCHUP, `pageType` vuelve a `LIVE` y `secsPlayed = 0`.

Condición de detección del live edge: `player.currentTime >= player.duration - player.edge`

Coverage: ⚠️ Tests E5/E6 — pendiente stream DVR local o mock con seekable window

---

## EC-07 — `secsPlayed` no incrementa durante pausa aunque el timer mhb llegue a 50s

El `setInterval` sigue corriendo durante pausa, pero el handler chequea `isPlaying === false` y no dispara el beacon.

Coverage: ✅ Test C4

---

## EC-08 — `player.load()` con nuevo contenido resetea todo el estado

Después de `player.load()`:
- `secsPlayed = 0`
- `_firstPlaySent = false`
- `mhb` interval se destruye y recrea
- nuevo `mloaded` se emite para el nuevo contenido

Coverage: ✅ Tests D5, H1, H2

---

## EC-09 — `dispose` se dispara aunque el player se destruya antes del primer play

Si el usuario destruye el player en estado `ready` sin haber reproducido, `dispose` aún se emite (con `secsPlayed=0` y `playerStatus=PAUSED`).

Coverage: ✅ Test B7 (implicit — destroy después del primer play)

---

## EC-10 — `mute` no dispara `unmute`

El contrato actual solo define `mute`. Si el usuario sube el volumen después de silenciar, no hay beacon. No es un bug — es el contrato definido por Konodrac.

Coverage: ✅ Test G2 (verifica solo mute)

---

## EC-11 — Usuario anónimo — `uid` totalmente ausente de la URL

La URL no debe contener `uid=` (ni `uid=null`, ni `uid=undefined`). El parámetro debe estar ausente.

Coverage: ✅ Test F7

---

## EC-12 — `cb` único en cada beacon de la misma sesión

`Date.now()` avanza entre beacons. En tests con fake clock, `page.clock.runFor()` avanza el tiempo artificial — los valores de `cb` pueden ser idénticos si se lanzan en el mismo tick.

En tests de `cb` único, usar verificación de unicidad solo contra beacons de eventos distintos (no contra múltiples `mhb`).

Coverage: ✅ Test F2

---

## EC-13 — `mhb` con múltiples pausas y reanudaciones en el mismo intervalo de 50s

Si el usuario pausa y reanuda varias veces dentro de una ventana de 50s, el `setInterval` sigue corriendo. Solo el tiempo activo (isPlaying=true) incrementa `secsPlayed`. El mhb solo dispara si `isPlaying === true` cuando el interval llega.

Ejemplo: play 20s → pause 30s → play 10s → [mhb tick a los 50s de clock real] → `secsPlayed ≈ 30` (20+10), beacon solo si estaba jugando al tick.

Coverage: ⚠️ Parcial — Test C4 cubre el caso de estar pausado al tick

---

## EC-14 — `error` beacon con error no-fatal

El contrato Konodrac define solo `event=error` sin distinción fatal/no-fatal (a diferencia de Youbora). El beacon se envía siempre que el player emita un evento error.

Coverage: ✅ Test G3

---

## EC-15 — `window.__tcfapi` no disponible

Si el CMP no está cargado (ej: usuario con adblocker del CMP, tests sin mock TCF), el tracker no puede obtener el TC String. Comportamiento esperado: enviar `gdpr=0` y `gdpr_consent=` vacío, o continuar sin parámetros GDPR. El tracker no debe bloquearse esperando el CMP.

Coverage: ⚠️ Pendiente — definir comportamiento exacto con el equipo del player
