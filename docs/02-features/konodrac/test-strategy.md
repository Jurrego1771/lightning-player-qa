---
type: test-strategy
feature: konodrac
version: "1.0"
status: draft
last_verified: 2026-05-05
---

# Test Strategy — Konodrac Mark Collector API

## Archivo de tests

`tests/integration/konodrac.spec.ts`

---

## Capa de testing

**Integration** — fixture `isolatedPlayer` (plataforma mockeada + stream HLS local).

No hay tests E2E para Konodrac: los beacons son pixel GET silenciosos — no hay feedback visual ni estado en la UI del player que dependa de Konodrac. La única señal observable es la request de red.

---

## Estrategia de observabilidad

Interceptar `page.route(/marker\.konograma\.com/)` ANTES de `player.goto()`. Los parámetros están en la query string — se parsean con `new URL(route.request().url()).searchParams`.

Ver `observability.md` para el helper `setupKonodracInterceptor()` completo.

---

## Grupos de tests y prioridades

### Prioridad CRÍTICA — bloquea aceptación

| ID | Descripción |
|----|-------------|
| A1 | Sin config Konodrac → cero beacons |
| A2 | `enabled: false` → cero beacons |
| B1 | `mloaded` con parámetros correctos |
| B2 | `firstplay` en primera reproducción |
| B4 | `play` al reanudar (no primera vez) |
| B5 | `pause` al pausar |
| F1 | `sysEnv=web` en todos los beacons |
| F4 | `cid` coincide con content id |
| F5 | `dataset` coincide con config |
| F10-F11 | `playerStatus` correcto por evento |

### Prioridad ALTA

| ID | Descripción |
|----|-------------|
| B3 | `firstplay` solo se emite una vez |
| B6 | `endplay` al terminar contenido |
| B7 | `dispose` al destruir |
| C1-C3 | mhb timing (fake clock) |
| C4-C5 | mhb se pausa/reanuda con el player |
| D1-D4 | secsPlayed state machine |
| D5 | secsPlayed reset en player.load() |
| F2-F3 | cb único y dinámico |
| F7 | uid ausente en usuario anónimo |
| F9 | gdpr + gdpr_consent con TCF mock |
| H1-H3 | restart / multi-contenido |

### Prioridad MEDIA

| ID | Descripción |
|----|-------------|
| A3 | Con config válida → beacons se envían |
| C6 | secsPlayed acumulado en mhb |
| D6 | secsPlayed reset en seek LIVE |
| E1-E4 | pageType LIVE/CATCHUP en seek |
| F6 | channel coincide con config |
| F8 | uid presente en usuario autenticado |
| G1 | fullscreen beacon |
| G2 | mute beacon |
| G3 | error beacon |
| G4 | seek beacon en VOD |

### Prioridad BAJA (pendiente infraestructura)

| ID | Descripción | Bloqueado por |
|----|-------------|---------------|
| E5-E6 | Volver de CATCHUP a LIVE + secsPlayed reset | Stream DVR local o mock seekable window |

---

## Técnicas especiales

### Fake clock para mhb

```typescript
await page.clock.install()  // ANTES de page.goto
// ... setup interceptor y goto ...
await page.clock.runFor(50_000)  // ejecuta setInterval de 50s
```

### Mock TCF/GDPR

```typescript
await page.addInitScript(() => {
  (window as any).__tcfapi = (cmd: string, _v: number, cb: Function) => {
    if (cmd === 'getTCData') cb({ tcString: 'MOCK_TC_STRING', gdprApplies: true }, true)
  }
})
```

### Activar Konodrac via mockPlayerConfig

```typescript
const KONODRAC_CONFIG = {
  metadata: { player: { tracking: { konodrac: {
    enabled: true, dataset: 'CARTV_OTT_TEST', channel: 'CARTV'
  }}}}
}
// Llamar ANTES de player.goto() — LIFO routing en Playwright
await mockPlayerConfig(page, KONODRAC_CONFIG)
```

---

## Anti-patrones a evitar

```typescript
// MAL — conteo absoluto de beacons
expect(beacons.length).toBe(3)  // mhb agrega beacons según tiempo transcurrido

// BIEN — filtrar por evento
expect(beacons.filter(b => b.event === 'firstplay')).toHaveLength(1)
```

```typescript
// MAL — waitForTimeout
await page.waitForTimeout(5000)

// BIEN — expect.poll
await expect.poll(() => beacons.some(b => b.event === 'firstplay'), { timeout: 10_000 }).toBe(true)
```

```typescript
// MAL — glob para marker.konograma.com
await page.route('**marker.konograma.com/**', ...)  // puede no matchear en Playwright

// BIEN — regex
await page.route(/marker\.konograma\.com/, ...)
```

---

## Dependencias de entorno

| Dependencia | Tests afectados | Estado |
|---|---|---|
| Stream HLS local (localhost:9001) | Todos | ✅ Disponible vía webServer |
| Mock player config con tracking.konodrac | Todos | ✅ via mockPlayerConfig() |
| CARTV_OTT_TEST dataset (test) | Todos | ✅ Hardcodeado en tests |
| Stream DVR local con seekable window | E5, E6 | ⚠️ Pendiente |
| Implementación en el player | Todos | ❌ No implementado aún |

---

## Notas sobre implementación pendiente

Todos los tests en este archivo están marcados con `test.skip(true, 'pending player implementation')` hasta que `src/analytics/konodrac/tracker.js` exista en el repo del player. Al implementar, quitar los skips uno a uno a medida que cada test pase.
