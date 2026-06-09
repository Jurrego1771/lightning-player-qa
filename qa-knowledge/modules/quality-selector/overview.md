# Quality Selector — Overview

## Qué hace

El módulo **quality-selector** expone la API pública de selección de calidad de video (resolución/bitrate) del Lightning Player. Permite:

- Listar las representaciones de calidad disponibles del manifest (`player.levels`).
- Leer el nivel de calidad activo (`player.level`) y el nivel solicitado/pendiente (`player.nextLevel`).
- Fijar manualmente un nivel de calidad (`player.level = N`) — esto **deshabilita ABR**.
- Re-habilitar ABR automático (`player.level = -1` o `player.nextLevel = -1`).
- Saber si ABR está activo (`player.autoLevelEnabled`).
- Observar telemetría de red/codificación: ancho de banda estimado (`player.bandwidth`), bitrate del nivel activo (`player.bitrate`), frames descartados (`player.droppedFrames`).

A diferencia de lo que indicaba la documentación legacy, **la API de calidad funciona tanto en HLS (hls.js) como en DASH (dash.js 5.1.1)**. Ambos handlers normalizan los niveles a un array 0-indexado uniforme y emiten los mismos eventos (`levelchange` / `levelchanged`), de modo que el consumidor de la API no necesita saber qué protocolo está activo.

`level = -1` significa **ABR auto** (el algoritmo del motor de streaming decide el nivel). Cualquier valor `>= 0` fija ese índice del array `levels`.

## Archivos clave

| Archivo | Rol |
|---------|-----|
| `src/player/handler/hls/handler.js` | Handler HLS (hls.js). Implementa `get('level'|'levels'|'nextLevel'|'bandwidth'|'bitrate'|'autoLevelEnabled')` y `set('level')`. Emite `levelchange`/`levelchanged` desde `LEVEL_SWITCHING`/`LEVEL_SWITCHED`. |
| `src/player/handler/dash/handler.js` | Handler DASH (dash.js 5.1.1). Mismo contrato de `get`/`set`; mapea representaciones de dash.js a niveles 0-indexados. Usa `setRepresentationForTypeByIndex` + `updateSettings({streaming:{abr:{autoSwitchBitrate}}})`. |
| `src/player/base.js` | Expone `level` (R/W) y `levels`, `nextLevel`, `autoLevelEnabled`, `bandwidth`, `bitrate`, `droppedFrames`, `edge` (read-only) sobre la API pública vía `expose()`. |
| `src/view/video/atoms/level.js` | Estado reactivo (jotai) que escucha `levelchange`/`levelchanged`/`canplay` para alimentar la UI (`useLevel`, `useLevels`, `useSelectedLevel`). |
| `src/view/video/components/controls/options/levelsAccordionItem.jsx` | Componente UI del selector de calidad (asigna `api.level = value` al hacer clic). |
| `src/api/legacyApiCompat.js` | Puente postMessage legacy: comandos `playbackLevel` (set) y `playbackLevels` (get) → `player.level` / `player.levels`. |
| `constants.cjs` | Define eventos públicos `levelchange`/`levelchanged` y nombres de propiedad `level`/`levels`/`nextLevel`/`autoLevelEnabled`/`bandwidth`/`bitrate`. |

## Flujo de datos

```
                       player.level = N   (API pública / UI accordion)
                              │
                              ▼
                     base.js  set('level', N)
                              │
            ┌─────────────────┴──────────────────┐
            ▼ (HLS)                               ▼ (DASH)
   hls.handler set('level')               dash.handler set('level')
   - valida N < levels.length             - valida 0 <= N < levels.length
     (N!==-1) → throw 'Invalid level'      - N===-1 → autoSwitchBitrate=true
   - nextLevel = N; loadLevel = N            (re-habilita ABR), emite levelchange(-1)
   - N===-1 desde manual → emite          - N>=0 → emite levelchange(N),
     levelchange(nextLevel) (fake)            autoSwitchBitrate=false,
                                              setRepresentationForTypeByIndex(N)
            │                                       │
            ▼                                       ▼
   hls.js LEVEL_SWITCHING ──► levelchange(nextLevel)
   hls.js LEVEL_SWITCHED  ──► levelchanged(currentLevel)
   dashjs QUALITY_CHANGE_REQUESTED ──► levelchange(idx)
   dashjs QUALITY_CHANGE_RENDERED  ──► levelchanged(currentLevel)
                              │
                              ▼
              internalEmitter (events module)
                              │
            ┌─────────────────┴─────────────────┐
            ▼                                    ▼
   atoms/level.js (UI reactiva)        externalEmitter → integrador
   (useLevel/useLevels/useSelected)    (window 'levelchange'/'levelchanged')
```

**Telemetría (read-only):**
- `bandwidth`: HLS lee `hls.bandwidthEstimate` (bits/seg). DASH lee `getAverageThroughput(mediaType) * 8` (bits/seg). Ambos pueden ser `null` antes del primer segmento descargado.
- `bitrate`: bitrate del nivel actualmente activo (`levels[level].bitrate`, bits/seg). `null` en DASH si `level === -1` o índice fuera de rango.
- `droppedFrames`: HLS acumula desde `FPS_DROP`; DASH lee `getDashMetrics().getCurrentDroppedFrames()`.

## API pública

| Propiedad | R/W | Tipo | Descripción |
|-----------|-----|------|-------------|
| `player.level` | R/W | `number` | Índice 0-based del nivel activo; `-1` = ABR auto. Set fija nivel (deshabilita ABR) o re-habilita ABR con `-1`. |
| `player.nextLevel` | R/W | `number` | Nivel solicitado/pendiente (puede diferir de `level` durante una transición). `-1` = auto. |
| `player.levels` | R | `Array<{index,height,width,bitrate,label}>` | Niveles disponibles del manifest. Vacío hasta que el manifest está parseado. |
| `player.autoLevelEnabled` | R | `boolean` | `true` si ABR está activo. |
| `player.bandwidth` | R | `number\|null` | Ancho de banda estimado en bits/seg. `null` antes del primer segmento. |
| `player.bitrate` | R | `number\|null` | Bitrate del nivel activo en bits/seg. |
| `player.droppedFrames` | R | `number` | Frames de video descartados acumulados. |

**Eventos públicos:**
- `levelchange` — se solicitó un cambio de nivel (manual o ABR), antes de que el nuevo nivel esté en el buffer reproduciéndose. Payload: `level: number`.
- `levelchanged` — el nuevo nivel ya está reproduciéndose. Payload: `level: number`. Sigue a `levelchange`.

**API legacy (postMessage / iframe):** comando `playbackLevel` (data: number) → set `player.level`; comando `playbackLevels` → retorna `player.levels`.

## Interacciones con otros sistemas

- **hls** / **dash**: la implementación real vive en los handlers de cada protocolo. Cambiar el contrato de `get`/`set('level')` en cualquiera de ellos rompe la API de calidad para ese protocolo.
- **events**: todos los cambios de nivel se propagan por `internalEmitter` (`levelchange`/`levelchanged`). El módulo de eventos los reexpone al integrador.
- **controls-api**: `base.js`/`controls` enrutan `get`/`set`. Si hay un ad manager activo, `controls.get('level')` puede ser interceptado por el ad manager (durante un ad linear), devolviendo el nivel del ad y no del contenido.
- **view (UI)**: `atoms/level.js` y `levelsAccordionItem.jsx` consumen la API para el selector visual. El menú no aparece si `levels` está vacío.
- **youbora/analytics**: el tracker de Youbora y streammetrics leen `bandwidth`/`bitrate`/`level`/`droppedFrames` para reportar QoE (rendition, throughput).
