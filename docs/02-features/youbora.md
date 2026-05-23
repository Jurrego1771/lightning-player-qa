---
feature: youbora
version: "1.0"
last_verified: 2026-04-29
spec: tests/integration/youbora.spec.ts
status: pending-tests
---

# Youbora (NPAW Analytics)

SDK `npaw-plugin@7.3.28` integrado en el player como plugin React (`YouboraAnalytics extends Base`).
No hay API pública — la única forma de observar Youbora desde QA es interceptando requests de red.

## Activación

```json
{ "metadata": { "player": { "tracking": { "youbora": {
  "enabled": true, "account_code": "ACCOUNT_CODE_STRING"
}}}}}
```

Path en mockPlayerConfig: `metadata.player.tracking.youbora`. Ambos campos requeridos.
No se activa en: `view.type === 'reels'`, `options.error` truthy, `enabled` falsy, `account_code` vacío.

## Vistas y tipos soportados

| Vista / tipo | Youbora activo |
|---|---|
| `video`, `none`, `compact`, `radio` | Sí (si habilitado) |
| `reels` | Nunca — plugin loader retorna `{}` |
| `media`, `episode` | `content.type = 'VOD'` |
| `live` | `content.type = 'Live'`, `duration = 0` |
| `dvr` | `content.type = 'DVR'`, `duration = 0` |

## Eventos → acciones NPAW

**Content adapter:**

| Evento player | Acción NPAW | Guarda |
|---|---|---|
| `contentFirstPlay` | `fireStart()` + `fireJoin()` | Solo si `!_started` (una vez por sesión) |
| `playing` | `fireResume()` | Solo si `_started && !_inAdBreak && _paused` |
| `pause` | `firePause()` | Solo si `_started && !_inAdBreak && !_paused` |
| `seeking` | `fireSeekBegin()` | Solo si `_started && !_inAdBreak` |
| `seeked` | `fireSeekEnd()` | Solo si `_started && !_inAdBreak` |
| `buffering` | `fireBufferBegin()` | Solo si `_started && !_inAdBreak` |
| `canplay` | `fireBufferEnd()` | Solo si `_started && !_inAdBreak` |
| `ended` | `fireStop()` | Solo si `_started` |
| `error` | `fireFatalError()` / `fireError()` | Siempre si adapter existe |
| `adsContentPauseRequested` | `firePause()` + `_inAdBreak=true` | Solo si `_started` |
| `adsContentResumeRequested` | `fireResume()` + `_inAdBreak=false` | Solo si `_started && _inAdBreak` |

**Ads adapter:**

| Evento player | Acción NPAW |
|---|---|
| `adsStarted` | `fireBreakStart()` (si primer ad del break) + `fireStart()` + `fireJoin()` |
| `adsFirstQuartile/Midpoint/ThirdQuartile` | `fireQuartile(1/2/3)` |
| `adsComplete` | `adsAdapter.fireStop()` |
| `adsAllAdsCompleted` | `adsAdapter.fireBreakStop()` |
| `adsError` | `adsAdapter.fireError()` |

## Reglas de negocio clave

**Sesión única por init:** `_started` se pone `true` en el primer `contentFirstPlay` y no se resetea hasta que el tracker sea destruido o reiniciado via `player.load()`.

**Reinicio en player.load():** `_cleanup()` → `adapter.fireStop()` → destroy plugin → `setTimeout(0)` → `init(newOptions)`. La secuencia garantiza que la sesión anterior se cierra antes de iniciar la nueva.

**Error code:** `String(data?.code ?? data?.type ?? 'unknown')`. Fatal si `data.fatal === true`.

**Metadata enviada:** `content.id`, `content.title`, `content.isLive`, `content.type`, `content.duration` (0 para live/dvr), `content.resource` (`api.src`), `app.name` (`options.appName` o `'lightning-player'`), `app.releaseVersion` (`process.env.VERSION`), `user.name` (`options.customer` si existe). Para `type === 'episode'`: `content.program`, `content.season`, `content.episodeTitle`.

**Balancer deshabilitado:** `new NpawPlugin(accountCode, { components: { balancer: false } })`.

**DNT no se verifica para Youbora** (a diferencia de StreamMetrics y GoogleTracker).

## Observabilidad — dominios y endpoints

El SDK usa **dos dominios distintos**:

| Sistema | Dominio | Propósito |
|---|---|---|
| LMA | `lma.npaw.com` | Init del plugin al instanciar — antes de `contentFirstPlay` |
| NQS | `*.youboranqs01.com` | Beacons reales de sesión |
| Legacy | `*.youbora.com` | No observado en v7.3.28 — preservar por compatibilidad |

Servidor NQS varía por sesión: `infinity-c37.youboranqs01.com`, `infinity-c39.youboranqs01.com`, etc.

```typescript
// CORRECTO — regex para capturar NQS (glob ** no matchea subdominios correctamente en Playwright)
await page.route(/\.npaw\.com\//, captureBeacon)        // LMA
await page.route(/youboranqs01\.com\//, captureBeacon)  // NQS beacons reales
await page.route(/\.youbora\.com\//, captureBeacon)     // legacy fallback

// INCORRECTO — no matchea en Playwright
await page.route('**youboranqs01.com/**', ...)  // ROTO
```

**Timing crítico:**
- `/resume` y `/seek` llegan con ~3s de delay vs el evento del player → usar `expect.poll` con timeout ≥5s
- Los requests LMA (`/configuration`, `/data`) se emiten al instanciar el plugin, no en `contentFirstPlay`

## Secuencias de beacons esperadas

**VOD normal (sin ads):**
```
new NpawPlugin → LMA: /configuration × 2, /data × 2
                 NQS: /init → /ping
contentFirstPlay → NQS: /error × 2 (arranque — ocurre consistentemente)
                   NQS: /joinTime → /ping × N → /start (~10s después de init)
pause            → NQS: /pause
playing          → NQS: /resume (~3s delay)
seeking + seeked → NQS: /seek (SDK consolida begin+end en un solo endpoint)
ended            → NQS: /pause → /stop
```

**Pre-roll:**
```
contentFirstPlay → NQS: /init → /joinTime
adsContentPauseRequested → NQS: /pause → /adBreakStart
adsStarted       → NQS: /adInit → /adManifest → /adStart → /adJoin
adsAllAdsCompleted
contentFirstPlay (post-ad) → NQS: /start
```

## Edge cases clave

| EC | Regla |
|---|---|
| `enabled` falsy / ausente | Cero beacons (componente nunca se monta) |
| `account_code` nulo/vacío | Cero beacons NQS (init retorna sin crear plugin) |
| LMA init antes de `contentFirstPlay` | 2 requests LMA siempre — no los contar en "destroy antes de play" (TB-08) |
| `player.load()` antes de `contentFirstPlay` | `adapter.fireStop()` puede enviarse para sesión nunca iniciada |
| `type === 'episode'` | Campos extra: `content.program`, `content.season`, `content.episodeTitle` |
| Seek begin sin seeked | Adapter queda en estado "seeking" indefinidamente |
| Error pre-`contentFirstPlay` | Se reporta igual (`_adapter` check solo verifica existencia, no `_started`) |

## Anti-patrones

```typescript
// ❌ glob para youboranqs01.com — no funciona en Playwright
await page.route('**youboranqs01.com/**', ...)

// ❌ número exacto de beacons
expect(beacons.length).toBe(3)  // heartbeats hacen el total impredecible

// ❌ waitForTimeout para dar tiempo al SDK
await page.waitForTimeout(5000)

// ✅ expect.poll para condición con timeout
await expect.poll(() => beacons.length, { timeout: 5000 }).toBeGreaterThan(0)

// ✅ filtrar por NQS para "destroy sin play"
const nqsBeacons = beacons.filter(u => u.includes('youboranqs01.com'))
expect(nqsBeacons.length).toBe(0)
```

## Prioridades de testing

**CRÍTICO:** TB-01 (disabled), TB-02 (no account_code), TB-03 (beacon en contentFirstPlay), TB-08 (destroy sin play)
**ALTO:** TB-04 (pause beacon), TB-05 (ad break suppression), TB-06 (ad beacons), TB-07 (player.load reset)
**MEDIO:** TB-09 (error reporting), EC-04 (seek sin seeked), EC-12 (DNT no se verifica)
