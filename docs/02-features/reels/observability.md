---
type: observability
feature: reels
version: "1.0"
status: draft
last_verified: 2026-04-26
---

# Observability — Reels

## Eventos públicos (emitidos por el player padre)

| Evento | Quién lo emite | Cuándo | Fuente |
|---|---|---|---|
| `ready` | `internalEmitter` | Una vez, cuando el primer ítem hijo emite `Events._ready` y la api se registra por primera vez en `apiAtomFamily` | [CODE: src/view/reels/atoms/api.js:38-43] |
| `metadatachanged` | `internalEmitter` | Cuando el ítem activo emite `metadatachanged`, si el `id\|src` key cambia (deduplicado) y no es un ad | [CODE: src/view/reels/components/controls.js:89-100] |

### Nota sobre `ready`

El evento `ready` del player padre se emite cuando `playerReadySentAtom` pasa de `false` a `true`. Esto ocurre la primera vez que el setter del `apiAtom` de cualquier ítem recibe un valor no-nulo. No se vuelve a emitir en navegaciones posteriores.

[CODE: src/view/reels/atoms/api.js:36-43]

---

## Señales de transición real

### Navegación entre slides

La única señal fiable de que el usuario cambió de slide es la actualización de `currentIndexAtom`. Externamente, esto se puede observar indirectamente via el evento `metadatachanged` del player padre, que se emite cuando el nuevo ítem activo tiene metadata diferente.

No hay un evento público dedicado de "slide change" en el player padre.

[CODE: src/view/reels/components/videoReels/index.js:69-75]
[CODE: src/view/reels/components/controls.js:84-108]

### Reproducción del ítem activo

Para saber si el ítem activo está reproduciendo, consultar `player.paused` o `player.status`. Ambos leen del `currentItemApiAtom`.

[CODE: src/view/reels/components/controls.js:128-138]

---

## API pública observable

```js
player.paused      // → boolean — true si el ítem activo está pausado
player.status      // → 'playing' | 'pause' | 'error' — del ítem activo
player.currentTime // → number — segundos del ítem activo
player.metadata    // → { title, description, tags, date, playerType: 'reels' } | null
player.volume      // → number 0–1 — volumen persistido entre ítems
player.goNext      // → Function — navega al siguiente slide
player.goPrevious  // → Function — navega al slide anterior
```

[CODE: src/view/reels/components/controls.js:112-162]

---

## Señales NO confiables

| Señal | Por qué no usarla |
|---|---|
| `player.status === 'playing'` durante setup | El player hijo puede emitir `playing` antes de que el slide sea activo (preload). El status del padre refleja solo el ítem activo, pero hay una ventana de race condition durante el cambio de `currentItemApiAtom`. |
| Eventos `play` / `pause` / `playing` del player padre | El player padre NO reenvía estos eventos. Solo `ready` y `metadatachanged` son reenviados via `internalEmitter`. Los eventos de reproducción del ítem activo quedan dentro del player hijo. |
| `player.metadata` durante cambio de slide | Hay una ventana entre que el slide cambia y que el nuevo ítem emite `metadatachanged`. Durante esta ventana `metadata` puede ser `null` o la metadata del ítem anterior. |
| `player.currentTime` en un ad slot | El ad slot expone `currentTime` pero es el tiempo del video de ad interno del IMA container, no el tiempo de contenido de la sesión. |
| La ausencia de `metadatachanged` para confirmar un cambio de slide | El evento se deduplica por `id\|src` key. Si el usuario navega de vuelta a un ítem ya visitado con la misma key, el evento no se emite de nuevo. |

---

## Reglas de aserción

1. Para verificar que el ítem activo está reproduciéndose → usar `player.paused === false` o `player.status === 'playing'`
2. Para verificar que se navegó a un nuevo ítem → escuchar `metadatachanged` Y verificar que `player.metadata.title` cambió
3. Para verificar que el feed se cargó inicialmente → esperar `ready` del player padre
4. Para verificar el volumen → usar `player.volume` (es el valor persistido entre ítems)
5. Para verificar el estado de un ad → no hay señal pública directa; se puede inferir por ausencia de `metadatachanged` (los ads no lo emiten al padre)

---

## Secuencias de eventos esperadas

### Init con autoplay

```
player.on('ready')           ← primer ítem hijo listo
player.on('metadatachanged') ← primer ítem emite metadata
```

### Navegación al siguiente ítem

```
player.goNext()
// swiper slideChange (10ms delay interno)
// currentItemApiAtom actualizado
// ítem anterior: api.pause() llamado
// ítem nuevo: api.play() llamado
player.on('metadatachanged')  ← si la metadata del nuevo ítem es diferente
```

### Ad slot aparece en feed

```
// No hay evento público cuando un ad slot entra al feed
// El ad no emite metadatachanged al padre (bloqueado por el check de metadataKey)
// player.paused puede seguir siendo false si el ad está reproduciéndose
```

### Error en un ad slot

```
// AdsManager emite AdError → adsManager se pone null → isValidAtom → false
// removeBadAdsAtomEffect elimina el ad de itemsInnerAtom
// No hay evento público de este flujo
```

---

## Payload de `metadatachanged`

```js
{
  title: string | null,
  description: string | null,
  tags: string[] | null,
  date: string | null,           // date_recorded o date_created del contenido
  playerType: 'reels',           // siempre presente para ítems de contenido
  id: string,                    // content id (viene del player hijo)
  src: string,                   // src del contenido (viene del player hijo)
  // ...otros campos que el player hijo propague en su metadata
}
```

[CODE: src/view/reels/components/controls.js:26-43]
[CODE: src/view/reels/atoms/metadata.js:7-16]
