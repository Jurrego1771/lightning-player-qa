---
feature: konodrac
version: "1.0"
last_verified: 2026-05-05
spec: tests/integration/konodrac.spec.ts
status: pending-player-implementation
---

# Konodrac Mark Collector API

Pixel GET tracking hacia `marker.konograma.com`. Sin SDK — el player construye URLs con `getImage()`.
Todos los tests están en `test.skip` hasta que `src/analytics/konodrac/tracker.js` exista en el player.

## Activación

```json
{ "metadata": { "player": { "tracking": { "konodrac": {
  "enabled": true, "dataset": "CARTV_OTT_TEST", "channel": "CARTV"
}}}}}
```
Path en mockPlayerConfig: `metadata.player.tracking.konodrac`. Los tres campos son requeridos.
No se activa en: `view.type === 'reels'`, `options.error` truthy, `enabled` falsy, `dataset` vacío.

## Endpoints

| Endpoint | Interceptar con |
|---|---|
| `https://marker.konograma.com/track` | `/marker\.konograma\.com/` |
| `https://marker.konograma.com/rdtrack` | idem |

## Eventos y parámetros

| Evento | Trigger player | Notes |
|---|---|---|
| `mloaded` | `metadataloaded`/`loaded` | secsPlayed=0, playerStatus=PAUSED |
| `firstplay` | `contentFirstPlay` | Una vez por contenido, nunca más |
| `play` | `play` (sin `_started`) | Solo en reanudaciones post-firstplay |
| `pause` | `pause` | — |
| `mhb` | setInterval 50s | Solo si isPlaying=true al tick |
| `seek` | `seeked` | pageType ya actualizado en el beacon |
| `endplay` | `ended` | — |
| `dispose` | `destroy()` / unmount | — |
| `fullscreen` | `fullscreenchange` | — |
| `mute` | `volumechange` cuando vol=0 | No hay unmute |
| `error` | `error` | Siempre, fatal/no-fatal igual |

Parámetros en query string: `dataset`, `event`, `cid`, `channel`, `pageType`, `sysEnv=web`,
`secsPlayed`, `playerStatus` (PLAYING/PAUSED), `currentPosition` (Math.floor), `gdpr=1`,
`gdpr_consent` (TCString), `cb` (Date.now()), `uid` (omitir si anónimo — no `uid=`).

## pageType por tipo de contenido

| player type | pageType | Transición |
|---|---|---|
| `media`, `episode`, `audio`, `radio` | VOD | — |
| `podcast` | PODCAST | — |
| `live`, `dvr` | LIVE | seek pasado → CATCHUP + secsPlayed=0; volver al edge → LIVE + secsPlayed=0 |

## Reglas de negocio clave

**secsPlayed state machine:**
```
on mloaded/load():      secsPlayed=0, isPlaying=false
on firstplay/play:      isPlaying=true, lastTimestamp=Date.now()
on pause/endplay:       secsPlayed += elapsed(), isPlaying=false
on mhb tick (isPlaying):secsPlayed += elapsed(), lastTimestamp=Date.now()
on seek LIVE→CATCHUP:   secsPlayed=0
elapsed() = Math.floor((Date.now() - lastTimestamp) / 1000)
```
`secsPlayed` nunca decrementa (VOD seek backward no resetea). Siempre entero.

**firstplay vs play:** `play` solo dispara cuando `_firstPlaySent=true`. En la primera reproducción solo va `firstplay`.

**mhb:** `setInterval(50_000)` siempre corre, pero el handler guarda `isPlaying` antes de emitir.

**GDPR:** leer `window.__tcfapi('getTCData', 2, cb)` al init, cachear TC string. Sin CMP: `gdpr=0`, `gdpr_consent=`.

**player.load():** resetea todo el estado (secsPlayed=0, _firstPlaySent=false, interval nuevo).

## Observabilidad

```typescript
// Interceptar ANTES de player.goto() — mloaded puede llegar antes de ready
const beacons: Array<Record<string, string>> = []
await page.route(/marker\.konograma\.com/, async route => {
  const u = new URL(route.request().url())
  beacons.push(Object.fromEntries(u.searchParams))
  await route.fulfill({ status: 200, body: '' })
})
```

**Fake clock para mhb** (requiere Playwright ≥ 1.45, usar `runFor` no `fastForward`):
```typescript
await page.clock.install()  // antes de page.goto
// ... setup interceptor, mockPlayerConfig, goto ...
await page.clock.runFor(50_000)
await expect.poll(() => beacons.filter(b => b.event === 'mhb')).toHaveLength(1)
```

**Mock TCF:**
```typescript
await page.addInitScript(() => {
  (window as any).__tcfapi = (_c: string, _v: number, cb: Function) =>
    cb({ tcString: 'MOCK_TC_STRING', gdprApplies: true }, true)
})
```

**Señal NO confiable:** `player.on('contentFirstPlay')` no garantiza que el beacon se disparó.

## Secuencias de beacons esperadas

**VOD normal:** `mloaded` → `firstplay` → `mhb`×N (cada 50s) → `pause` → `play` → `seek` → `endplay` → `dispose`

**LIVE con seek:** `mloaded` (pageType=LIVE) → `firstplay` → seek pasado → `seek` (pageType=CATCHUP, secsPlayed=0) → `mhb` (CATCHUP) → seek al edge → `seek` (pageType=LIVE, secsPlayed=0)

## Edge cases clave

| EC | Regla |
|---|---|
| Sin config | Cero beacons |
| `enabled: false` | Cero beacons |
| `firstplay` repetido | Solo 1 por contenido |
| VOD seek backward | secsPlayed NO decrementa |
| LIVE seek pasado | secsPlayed=0, pageType=CATCHUP |
| mhb durante pausa | No dispara aunque el tick llegue |
| `uid` anónimo | Parámetro totalmente ausente de URL |
| `cb` con fake clock | Puede repetirse en mismo tick — no verificar unicidad entre mhb del mismo evento |
| `window.__tcfapi` ausente | gdpr=0, gdpr_consent vacío (pendiente definir con equipo) |

## Prioridades de testing

**CRÍTICO:** A1, A2, B1, B2, B4, B5, F1, F4, F5, F10-F11
**ALTO:** B3, B6, B7, C1-C5, D1-D5, F2, F3, F7, F9, H1-H3
**MEDIO:** D6, E1-E4, G1-G4
**PENDIENTE infra:** E5-E6 (stream DVR local con seekable window)
