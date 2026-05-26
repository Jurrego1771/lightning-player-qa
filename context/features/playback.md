# Playback

Feature: reproducción de contenido VOD, Live y DVR.

---

## Descripción

El módulo de playback gestiona la reproducción de streams multimedia en tres modalidades:
- **VOD:** archivo a demanda con duración fija, seek libre en todo el rango.
- **Live:** stream en tiempo real sin seek backward (a menos que tenga DVR).
- **DVR:** live con ventana de seek hacia atrás configurable (típicamente 30–120 min).

La selección del handler (HLS / DASH / Native) es automática según el tipo de stream.

---

## Archivos del player (src/)

- `src/player/base.js` — playback-core: lógica base compartida por todos los handlers.
- `src/player/handler/hls/` — handler HLS (hls.js 1.6.13). Variantes: full, light, beta.
- `src/platform/loadConfig.js` — resolución de config, selección de handler.
- `src/context/index.jsx` — atoms Jotai de estado (status, currentTime, duration, etc.).
- `src/api/api.js` — bootstrap y exposición de la API pública.
- `constants.cjs` — constantes del player (tipos de stream, estados, etc.).

---

## API pública expuesta

```typescript
// Reproducción
player.play(): Promise<void>
player.pause(): void
player.seek(time: number): void         // segundos absolutos (VOD) o relativos al liveEdge (DVR)

// Estado (Jotai atoms — siempre async)
player.status: 'playing' | 'pause' | 'buffering' | 'idle' | 'error'
player.currentTime: number              // segundos
player.duration: number                 // NaN en live puro
player.paused: boolean

// Calidad (solo HLS)
player.level: number                    // -1 = ABR auto, N = nivel fijo
player.levels: QualityLevel[]          // array de niveles disponibles
player.bandwidth: number               // bps estimado actual

// Eventos
player.on('playing', cb)
player.on('pause', cb)
player.on('buffering', cb)
player.on('timeupdate', cb)
player.on('seeking', cb)
player.on('seeked', cb)
player.on('ended', cb)
player.on('error', cb)
player.on('ready', cb)
```

---

## Señales de observabilidad (eventos, estados)

| Señal | Tipo | Descripción |
|---|---|---|
| `ready` | evento | Player inicializado, API disponible |
| `playing` | evento + status | Reproducción activa |
| `pause` | evento + status | Reproducción pausada |
| `buffering` | evento + status | Buffer insuficiente, esperando datos |
| `timeupdate` | evento | `currentTime` se actualizó (~250 ms) |
| `seeking` | evento | Seek iniciado |
| `seeked` | evento | Seek completado, reproducción lista |
| `ended` | evento | VOD terminó |
| `error` | evento | Error de red, decodificación o DRM |
| `levelChanged` | evento | Cambio de nivel de calidad (ABR) |

---

## Tipos de contenido soportados

| Tipo | Extensión / MIME | Handler | ABR | DRM |
|---|---|---|---|---|
| HLS | `.m3u8` / `application/vnd.apple.mpegurl` | hls.js | Si | Widevine/PlayReady |
| DASH | `.mpd` / `application/dash+xml` | Native MSE | No (browser) | EME nativo |
| MP4 | `.mp4` / `video/mp4` | Native HTML5 | No | No |
| WebM | `.webm` / `video/webm` | Native HTML5 | No | No |
| HLS (Safari) | `.m3u8` | Native (Safari) | Limitado | FairPlay |

---

## Riesgos conocidos

- **api-bootstrap (CRITICAL):** Si `src/api/api.js` falla, ningún player carga. Mayor impacto en cascada.
- **Jotai async:** assertions directas post-acción fallan intermitentemente. Usar `expect.poll`.
- **DVR seek range:** en streams con DVR, `seekableStart` puede cambiar mientras el player está abierto (ventana deslizante). Seek a una posición que ya salió del rango lanza error silencioso.
- **HLS variantes:** `light` no incluye todas las features (e.g., EME limitado). Un test que asume `full` puede fallar con `light`.
- **DASH ABR:** `player.level` no tiene efecto en DASH — no está documentado como no-op, puede confundir.

---

## Casos edge

- **Live + DVR activado tarde:** el player puede iniciar sin DVR y activarlo dinámicamente. El rango seekable cambia después de `ready`.
- **Buffer stall en live:** si el buffer se agota en live, el player entra en `buffering` y hace rebuffer al live edge (no al punto anterior).
- **Seek antes de `ready`:** llamar `player.seek()` antes del evento `ready` es no-op. Esperar `ready` antes de cualquier acción.
- **Autoplay bloqueado por browser:** `play()` puede ser rechazado sin interacción del usuario. El player emite `error` con código de autoplay policy. Testear con `page.click()` previo o `--autoplay-policy=no-user-gesture-required`.
- **Duración en live puro:** `player.duration` retorna `Infinity` o `NaN`. No asertar valor numérico finito en live sin DVR.
- **HLS vs Safari native:** en Safari, hls.js cede al handler nativo para HLS. El comportamiento de ABR y los eventos pueden diferir levemente.
