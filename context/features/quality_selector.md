# Quality Selector

Feature: selector de calidad manual y ABR automático.

---

## Descripción

El player expone una API para seleccionar la calidad de reproducción. El ABR (Adaptive Bitrate) automático es gestionado por hls.js en streams HLS. En DASH y streams nativos, no hay control ABR desde la API pública del player.

---

## Archivos del player (src/)

- `src/player/handler/hls/` — hls.js handler: gestiona `currentLevel`, `nextLevel`, `autoLevelEnabled`.
- `src/controls/` — controls-api: expone `level` y `levels` al exterior.
- `src/context/index.jsx` — atoms Jotai: `levelAtom`, `levelsAtom`, `bandwidthAtom`.
- `src/api/api.js` — getters/setters públicos para `level`, `levels`, `bandwidth`.
- `constants.cjs` — constante `AUTO_LEVEL = -1`.

---

## API pública expuesta

```typescript
// Niveles disponibles (array, solo HLS)
player.levels: QualityLevel[]
// Shape de QualityLevel:
// { id: number, height: number, width: number, bitrate: number, name?: string }

// Nivel actual
player.level: number          // -1 = ABR auto, 0..N = nivel fijo

// Setter para cambiar nivel
player.level = -1             // activar ABR auto
player.level = 2              // fijar nivel 2 (según índice en player.levels)

// Ancho de banda estimado actual (bps)
player.bandwidth: number

// Próximo nivel (puede diferir del actual durante transición)
// No siempre expuesto públicamente — verificar con player.level post-transición

// Eventos
player.on('levelChanged', (level: number) => void)
```

---

## Señales de observabilidad (eventos, estados)

| Señal | Tipo | Descripción |
|---|---|---|
| `levelChanged` | evento | Nivel de calidad cambió (ABR o manual) |
| `player.level` | propiedad | Nivel activo actual (-1 = auto) |
| `player.levels` | propiedad | Array de niveles disponibles |
| `player.bandwidth` | propiedad | Estimado de bandwidth actual en bps |

---

## Tipos de contenido soportados

| Handler | ABR auto | Control manual | `player.levels` | `player.bandwidth` |
|---|---|---|---|---|
| HLS (hls.js full) | Si | Si | Array completo | Si |
| HLS (hls.js light) | Si | Limitado | Array completo | Si |
| DASH (native MSE) | Browser gestiona | No | Puede ser vacio | No |
| Native HTML5 | No | No | `[]` | No |

---

## Riesgos conocidos

- **DASH ABR no controlable:** `player.level = 2` en un stream DASH es un no-op silencioso. No lanza error. Tests que asuman control ABR en DASH darán false positive.
- **Jotai async:** `player.levels` puede ser `[]` durante el inicio hasta que hls.js carga el manifiesto. Usar `expect.poll` para esperar niveles disponibles.
- **Nivel fijo durante stall:** si se fija un nivel alto y la red no puede sostenerlo, hls.js puede entrar en loop de rebuffering. El player no revierte a ABR auto automáticamente.
- **`nextLevel` vs `level`:** hls.js usa `nextLevel` internamente para el próximo segmento a cargar. `player.level` refleja el nivel del segmento actualmente en reproducción, que puede ser distinto al siguiente.

---

## Casos edge

- **0 niveles disponibles:** `player.levels = []` es válido durante los primeros frames post-`ready`. Esperar al menos `timeupdate` para asumir que los niveles están cargados.
- **1 solo nivel:** streams con un único bitrate retornan `player.levels` con un elemento. `level = 0` y `level = -1` son equivalentes.
- **ABR durante ad break:** durante `adsContentPauseRequested`, el ABR de hls.js puede pausarse. Al reanudar en `adsContentResumeRequested`, el ABR puede seleccionar un nivel diferente al previo al ad.
- **Cambio de nivel muy rápido:** llamar `player.level = N` varias veces en el mismo tick puede resultar en que hls.js solo aplique el último valor. No hay cola de cambios de nivel.
- **Bandwidth estimation warm-up:** `player.bandwidth` puede ser 0 o muy bajo en los primeros segundos hasta que hls.js tenga suficientes muestras de descarga.
- **Level names:** `QualityLevel.name` puede ser undefined si el manifiesto no incluye nombres explícitos. No asertar sobre `name` sin verificar que existe.

---

## auto = -1 (ABR automático)

```typescript
// Activar ABR auto
player.level = -1

// Verificar que ABR está activo
expect(player.level).toBe(-1)
// O, tras estabilización:
await expect.poll(() => player.level).toBe(-1)
```

Cuando ABR está activo, `levelChanged` se emite cada vez que hls.js ajusta el nivel según el bandwidth estimado. En tests de ABR, es esperable que `levelChanged` se emita múltiples veces durante la reproducción.
