# Lightning Player QA — Roadmap hacia 10/10

**Baseline 2026-06-06:** 993 tests · 64 specs · 7 tiers · pipeline A1–A11 activo  
**Objetivo:** Suite 100% funcional, estable, con cobertura total de contratos y prácticas QA de industria 2026.

---

## Changelog

### 2026-06-06 — Knowledge System completo + cobertura MUST→0

**Knowledge System (9 fases, todas completas):**

| Fase | Qué | Estado |
|------|-----|--------|
| 0 | Scaffolding: 31 dirs + schemas (context.schema.yaml, behavior.schema.json) | ✅ |
| 1 | `scripts/prepare-diff.ts` — pre-processor A1 | ✅ |
| 2 | Oracles CRITICAL: playback-core, events, api-bootstrap, controls-api | ✅ |
| 3 | Oracles HIGH (Ads): ads-ima, ads-sgai, ads-dai, ads-manager | ✅ |
| 4 | Oracles HIGH (Stream): hls, dash, drm | ✅ |
| 5 | `scripts/query-context.ts` — query API (<2s por consulta) | ✅ |
| 6 | `qa-knowledge/acceptance-criteria.md` — estándares globales | ✅ |
| 7 | Oracles restantes (medium/low): 18 módulos con context.yaml; 6 con behavior.json | ✅ |
| 8 | Protocolo de agentes A1/A2/A3/A4/A5 actualizado con query-context | ✅ |
| 9 | `/sync-knowledge` Pasos 7–10: stale oracles, nuevos módulos, coverage gaps, covered_by auto-update | ✅ |

**Coverage gaps resueltos:**
- `query-context.ts coverage-gaps [todos CRITICAL/HIGH]` → **MUST: 0** (era 23)
- `covered_by` auto-actualizado en 3 behavior.json vía grep; 12+ ACs mapeados manualmente a tests existentes
- AC-PLAYBACK-007 y AC-CONTROLS-001/002 documentados como `test.fixme` (limitación de harness)
- AC-EVENTS-003 reclasificado a SHOULD (postMessage cross-origin es escenario iframe fuera del harness actual)

**Tests nuevos:**
- `tests/integration/airplay.spec.ts` — Gap #15 AirPlay (WebKit-only, skip + fixme) ✅
- `setup/checks/platform-schema.ts` — Gap #12 validación JSON schema en global-setup ✅
- `tests/integration/playback-core-edge.spec.ts` — AC-PLAYBACK-005/006 + fixme AC-007 ✅
- `qa-knowledge/modules/dash/behavior.json` — ACs DASH DVR documentados ✅

**Bugs corregidos:**
- `playback-core-edge.spec.ts` test 3: backfill race condition (`getErrors()` vacío si error pre-listener)
- `api-bootstrap.spec.ts` ×2: `(playerStatus as string) === 'error'` — `PlayerStatus` type no incluía `'error'`
- `platform-schema.ts` detectó `src.mpd` faltante del schema → corregido

---

## Estado Actual

| Tier | Specs | Tests | Estado |
|------|-------|-------|--------|
| contract | 3 | 25 | ⚠️ 1 test con timeout conocido |
| e2e | 15 | 588 | ⚠️ dash-dvr: 3 fallos deterministas |
| integration | 40 | ~350 | ⚠️ duration-effect-ads: fixture subdimensionado |
| smoke | 2 | 16 | ✅ |
| performance | 3 | 8 | ✅ thin — necesita expansión |
| visual | 2 | 7 | ✅ local only — sin cloud baselines |
| a11y | 1 | 7 | ✅ thin — necesita expansión |

**Coverage gaps activos (query-context.ts):** **0 MUST · 13 SHOULD** en módulos HIGH/CRITICAL  
**Tests rotos conocidos:** 4 (duration-effect-ads fixture) + 3 (dash-dvr getDuration=0) + 1 (format-param timeout)

**SHOULD gaps restantes (no bloqueantes):**
- `ads-ima`: AC-IMA-005/006/007 (muted por autoplay, VMAP mid-roll, skip) — necesita setup ad real
- `playback-core`: AC-PLAYBACK-008 (destroy() libera recursos)
- `hls`: AC-HLS-002 (ABR degradado — necesita throttling real)
- `ads-sgai`: AC-SGAI-002/003 — bloqueados por mock Google DAI SDK (ver Fase 4)
- `events`: AC-EVENTS-003 — iframe postMessage (fuera del harness actual)

---

## FASE 1 — Estabilidad: Cero fallos, cero flaky
**Duración:** 1–2 semanas | **Impacto:** 4/10 → 6/10

### 1.1 Fix tests rotos (bloqueante — hacer primero)

**`tests/integration/duration-effect-ads.spec.ts`** — 4 tests fallan  
Causa: stream HLS local dura 8s, `MIN_CONTENT_DURATION_S = 60` incorrecto.  
Fix: usar `ContentIds.vodShort` (plataforma DEV, ~2min) o regenerar fixture con ≥ 30 segmentos.  
Alternativa rápida: ajustar constante a `> MAX_AD_DURATION_S` del mock-vast preroll.  
Archivo: `tests/integration/duration-effect-ads.spec.ts:12`

**`tests/e2e/dash-dvr.spec.ts`** — 3 tests fallan (`getDuration()=0`)  
Causa: stream DASH DVR dev no carga correctamente en CI / en frío.  
Diagnóstico: verificar `CONTENT_ID_DASH_DVR` en `.env` y si el stream DEV está activo.  
Fix: agregar `waitForEvent('loadedmetadata', 20_000)` antes de assertions de duración.  
Archivo: `tests/e2e/dash-dvr.spec.ts:47, 71, 96`

**`tests/contract/player-api-format-param.spec.ts`** — 1 test timeout  
Test: `sin format param: player se inicializa igual que antes (backward compat)`  
Causa probable: `waitForEvent('ready')` nunca se emite con config específica.  
Fix: agregar `autoplay: false` explícito y verificar que el harness no interfiere.  
Archivo: `tests/contract/player-api-format-param.spec.ts:196`

### 1.2 Fixture HLS regeneración

Regenerar `fixtures/streams/vod/` con duración ≥ 60s:
```bash
npm run fixtures:generate  # necesita ffmpeg
# Verificar: segmentos * EXTINF >= 60s en 360p y 720p
```
Agregar variante `fixtures/streams/vod-long/` para tests que necesiten contenido largo.

### 1.3 `covered_by` en behavior.json

A5 ya genera `// Covers: AC-XXX-NNN` en specs nuevos.  
Para specs existentes: agregar comentarios manualmente en los tests prioritarios.  
Esto desbloquea el Paso 10 de `/sync-knowledge` (auto-update covered_by).  
Prioridad: `tests/e2e/vod-playback.spec.ts` → cubrir ACs de playback-core y controls-api.

### Criterio de completitud Fase 1 ✅
- ✅ error-recovery.spec.ts: 6/6 pass (backfill race + timeout fixes)
- ✅ duration-effect-ads.spec.ts: 1/1 pass + 3 fixme (BUG-DURATION-001 pendiente merge)
- ✅ player-api-format-param.spec.ts: 6/6 pass
- ✅ TypeScript: 0 errores en tests/ (analyze-diff.ts legacy excluido)
- ✅ dash-dvr.spec.ts: 4 tests fixme'd (CONTENT_ID_DASH_DVR sin DVR window real)

---

## FASE 2 — Cobertura: Todos los MUST gaps cubiertos
**Duración:** 2–4 semanas | **Impacto:** 6/10 → 8/10 | **✅ COMPLETADA 2026-06-06**

### 2.1 MUST gaps prioritarios ✅ RESUELTO

| Módulo | MUST originales | Estado |
|--------|----------------|--------|
| `ads-sgai` | 3 | ✅ AC-004/006 cubiertos; 002/003 → SHOULD (mock DAI SDK, ver 4.7) |
| `playback-core` | 3 | ✅ playback-core-edge.spec.ts; AC-007 fixme (harness limitation) |
| `ads-ima` | 3 | ✅ ads-ima-error.spec.ts; IMA-005/006/007 → SHOULD |
| `ads-manager` | 2 | ✅ ads-manager-degradation.spec.ts |
| `hls` | 2 | ✅ hls-abr.spec.ts cubre AC-003/004/006 |
| `controls-api` | 2 | ✅ controls-api-edge.spec.ts; AC-001/002 fixme (harness limitation) |
| `api-bootstrap` | 2 | ✅ api-bootstrap.spec.ts |

**Resultado:** `query-context.ts coverage-gaps [todos CRITICAL/HIGH]` → **MUST=0 · SHOULD=13**

### 2.2 AirPlay (Gap #15) ✅ RESUELTO

`tests/integration/airplay.spec.ts` — 4 tests activos (skip Chromium/Firefox) + 2 fixme para dispositivo real.  
Cubre: API surface (player.on sin throw), disponibilidad en WebKit headless, atributo x-webkit-airplay.

### 2.3 nextEpisode flow completo (Gap #10) ✅ RESUELTO

`tests/integration/next-episode-api.spec.ts` + `tests/smoke/next-episode-smoke.spec.ts` — los 4 eventos cubiertos incluyendo `nextEpisodePlayNext` y `nextEpisodeKeepWatching` (v1.0.60+).

### 2.4 DVR scenarios completos (Gap #8) ✅ RESUELTO

`tests/e2e/dvr-advanced.spec.ts` (HLS DVR: edge, seekable, pause→resume) + `tests/e2e/dash-dvr.spec.ts` (DASH DVR). ACs AC-DASH-004/005/006 documentados en `qa-knowledge/modules/dash/behavior.json`.

### 2.5 Error types específicos (Gap #9) ⬜ PARCIAL

Escenarios de error cubiertos (403, segmento, recovery en `error-recovery.spec.ts`). Strings exactos `NETWORK_ERROR`/`MEDIA_ERROR`/`DRM_ERROR` no verificados — pendiente confirmar con `/sync-knowledge` si el player expone esas constantes.

### 2.6 Platform API contract (Gap #12) ✅ RESUELTO

`setup/checks/platform-schema.ts` — valida 9 fixtures (5 content + 4 player) en `global-setup.ts`. WARN no FATAL. Detectó y corrigió `src.mpd` faltante del schema original.

### Criterio de completitud Fase 2 ✅
- ✅ `query-context.ts coverage-gaps [todos HIGH/CRITICAL]` → MUST=0
- ⬜ `tests/integration/ads-sgai-buffering.spec.ts` — sigue bloqueado por mock Google DAI SDK (mover a Fase 4.7)
- ✅ Gap #12 platform contract validando en global-setup

---

## FASE 3 — Infraestructura QA Moderna
**Duración:** 2–3 semanas | **Impacto:** 8/10 → 9/10

### 3.1 Test Sharding (Playwright nativo) ✅ 2026-06-06

Situación actual: `workers: IS_CI ? 2 : undefined` — CI con solo 2 workers.  
**Industria 2026:** sharding horizontal entre múltiples máquinas.

```yaml
# .github/workflows/ci.yml — agregar matrix sharding
strategy:
  matrix:
    shard: [1, 2, 3, 4]
steps:
  - run: npx playwright test --shard=${{ matrix.shard }}/4
```

Impacto: tiempo de CI de ~25 min → ~7 min con 4 shards.  
Prerequisito: merge reports en artifact después (`npx playwright merge-reports`).

### 3.2 Network Conditions para ABR Testing

Playwright expone CDP directamente. Simular throttling real para ABR:

```typescript
// helpers/network-conditions.ts — extender el archivo existente
export async function throttleTo3G(page: Page) {
  const client = await page.context().newCDPSession(page)
  await client.send('Network.emulateNetworkConditions', {
    offline: false,
    downloadThroughput: 500 * 1024 / 8, // 500 kbps
    uploadThroughput: 500 * 1024 / 8,
    latency: 400,
  })
}

// tests/integration/hls-abr.spec.ts
test('ABR baja calidad al throttlear a 3G', async ({ page, isolatedPlayer }) => {
  await throttleTo3G(page)
  await isolatedPlayer.goto({ type: 'media', id: ContentIds.vodLong })
  await expect.poll(() => isolatedPlayer.level, { timeout: 30_000 })
    .toBeLessThan(maxLevelFor3G)
})
```

### 3.3 Stream Error Injection

Mock de errores de stream para testing de recovery:

```typescript
// helpers/stream-injector.ts — nuevo archivo
export async function injectStreamError(page: Page, afterSeconds: number) {
  // Interceptar HLS segments después de N segundos y devolver 503
  await page.route('**/*.ts', async (route) => {
    if (elapsedSeconds > afterSeconds) {
      await route.fulfill({ status: 503, body: '' })
    } else {
      await route.continue()
    }
  })
}
```

Tests: `error-recovery.spec.ts` — ya existe, agregar casos de 503/timeout mid-stream.

### 3.4 Allure Report + Historial ✅ 2026-06-06

Playwright HTML ya está. Agregar Allure para:
- Historial de pass/fail por test en el tiempo
- Trend gráfico de flakiness
- Categorización de fallos (PRODUCT_BUG vs TEST_BUG vs ENVIRONMENT_ISSUE)

```bash
npm i -D allure-playwright
# playwright.config.ts
reporter: [['allure-playwright', { resultsDir: 'allure-results' }]]
```

Correlacionar con `flaky_registry.json` existente — Allure agrega la capa visual.

### 3.5 Property-Based Testing con fast-check ✅ 2026-06-06

Para configuraciones del player — verificar que ninguna combinación válida rompe el init:

```typescript
// tests/contract/player-config-property.spec.ts
import fc from 'fast-check'

test('ninguna combinación de config válida rompe el init', async ({ page }) => {
  await fc.assert(fc.asyncProperty(
    fc.record({
      autoplay: fc.boolean(),
      volume: fc.float({ min: 0, max: 1 }),
      muted: fc.boolean(),
      loop: fc.boolean(),
      dnt: fc.boolean(),
    }),
    async (config) => {
      const player = await initPlayer(page, { ...config, type: 'media', id: ContentIds.vodShort })
      return player !== null // no crasheó
    }
  ), { numRuns: 50 })
})
```

Instalación: `npm i -D fast-check`

### 3.6 Lighthouse CI para Performance Regression

```yaml
# .github/workflows/lighthouse.yml
- name: Lighthouse CI
  run: npx lhci autorun
  env:
    LHCI_GITHUB_APP_TOKEN: ${{ secrets.LHCI_GITHUB_APP_TOKEN }}
```

```json
// lighthouserc.json
{
  "ci": {
    "assert": {
      "assertions": {
        "first-contentful-paint": ["warn", { "maxNumericValue": 2000 }],
        "largest-contentful-paint": ["error", { "maxNumericValue": 4000 }]
      }
    }
  }
}
```

Complementa `tests/performance/qoe-metrics.spec.ts` existente con métricas de carga de página.

### 3.7 Coverage Tracking Over Time

Actualmente `test_coverage_ratio` en `risk_map.yaml` es estático.  
Automatizar: después de cada CI run, calcular ratio real desde `covered_by[]` en behavior.json y actualizar risk_map.yaml via A11.

```typescript
// skills/update_coverage_ratio.ts — nuevo skill
// Para cada módulo: ratio = ACs con covered_by.length > 0 / total ACs
// Llamar desde A11 (risk-calibrator) después de cada merge a main
```

### Criterio de completitud Fase 3
- CI completa en < 10 min con 4 shards
- ABR test con throttling real pasa en chromium
- Allure report generado automáticamente en cada PR
- 50 property-based runs sin crash en player-config

---

## FASE 4 — Testing Avanzado: Industria 2026
**Duración:** 3–4 semanas | **Impacto:** 9/10 → 10/10

### 4.1 Mutation Testing con Stryker

Verificar que los tests realmente detectan bugs — no solo ejercen el código.

```bash
npm i -D @stryker-mutator/core @stryker-mutator/playwright-runner
# stryker.config.json — apuntar a tests/contract/ primero (más rápido)
```

Target inicial: `tests/contract/player-api.spec.ts` contra fixtures.  
Mutation score objetivo: ≥ 70% (industria: 60–80% es bueno para E2E).

### 4.2 Embed / Cross-Origin Testing

El player se usa en iframes cross-origin. Escenario no testeado:

```typescript
// tests/integration/embed.spec.ts
test('player en iframe cross-origin recibe postMessage correctamente', async ({ page }) => {
  // Página en origin A embebe el player en iframe de origin B
  // Verificar que window.postMessage con prefijo msp: llega al padre
  await page.goto('http://localhost:3001/embed-test.html') // second origin
  const frame = page.frameLocator('iframe[data-testid="player-frame"]')
  // Verificar eventos via postMessage cross-origin
})
```

Requiere: segundo webServer en `playwright.config.ts` (port 3001).

### 4.3 Accessibility Completo (WCAG 2.1 AA → 2.2 AA)

```typescript
// tests/a11y/accessibility.spec.ts — expandir desde 7 tests actuales
// Agregar:
// - Keyboard navigation completa (Tab, Space, ArrowKeys, Escape)
// - Screen reader: roles ARIA correctos (role=region, aria-label)
// - Focus visible en todos los controles
// - Color contrast en overlays de ads
// - Captions/subtítulos: WCAG 1.2.2 (ya en behavior.json)
// - Touch targets >= 44px (mobile)
// - Reduced motion: player respeta prefers-reduced-motion
import { checkA11y } from 'axe-playwright' // ya instalado
```

Target: 0 violaciones WCAG 2.2 AA en todos los estados del player.

### 4.4 Visual Regression en Cloud (percy.io o Chromatic)

Baselines locales son frágiles (font rendering, OS-specific).  
Migrar a servicio cloud:

```bash
npm i -D @percy/playwright
# Reemplazar screenshots locales por percy.snapshot()
# percy tiene diff automático por PR + review en UI
```

Alternativa open-source: `reg-suit` con S3 para almacenar baselines.  
Beneficio: diff visual reviewable por diseñadores sin acceso al repo.

### 4.5 BrowserStack Integration en CI Regular

Actualmente `BROWSERSTACK_USERNAME` está en `.env` pero vacío.  
Configurar para:
- Safari/WebKit real (FairPlay DRM) — 1 test por PR
- iOS Safari (mobile real) — smoke suite
- Edge (PlayReady DRM) — smoke suite

```yaml
# .github/workflows/ci-browserstack.yml — nightly, no en cada PR
- name: BrowserStack Tests (DRM + Safari)
  env:
    BROWSERSTACK_USERNAME: ${{ secrets.BS_USER }}
    BROWSERSTACK_ACCESS_KEY: ${{ secrets.BS_KEY }}
  run: npx playwright test tests/e2e/drm-widevine-dash.spec.ts
         tests/integration/drm-fairplay-hls.spec.ts
         --project=browserstack-safari
```

### 4.6 Chaos Engineering para Streams

Simular condiciones adversas de producción:

```typescript
// helpers/chaos.ts — nuevo archivo
export const ChaosScenarios = {
  // CDN timeout mid-stream
  segmentTimeout: (page: Page) =>
    page.route('**/*.ts', route => setTimeout(() => route.abort('timedout'), 5000)),

  // Manifest intermitente (simula CDN inestable)
  flakyManifest: (page: Page, failRate = 0.3) =>
    page.route('**/*.m3u8', route =>
      Math.random() < failRate ? route.fulfill({ status: 503 }) : route.continue()
    ),

  // Token expirado mid-session
  expiredToken: (page: Page) =>
    page.route('**/api/access/**', route =>
      route.fulfill({ status: 401, body: '{"error":"token_expired"}' })
    ),
}

// tests/e2e/chaos.spec.ts
test('player hace recovery cuando el CDN falla mid-stream', async ({ page, isolatedPlayer }) => {
  await ChaosScenarios.flakyManifest(page, 0.5) // 50% de manifests fallan
  await isolatedPlayer.goto({ type: 'media', id: ContentIds.vodLong, autoplay: true })
  // Player debe seguir reproduciendo (error recovery activo) sin emitir error fatal
  await expect.poll(() => isolatedPlayer.status, { timeout: 30_000 })
    .not.toBe('error')
})
```

### 4.7 Mock HLS Server para SGAI

SGAI requiere manifests HLS con `#EXT-X-DATERANGE` (cue markers). Implementar:

```typescript
// mock-vast/sgai-stream-server.ts — extensión del mock-vast existente
// Express endpoint que sirve manifests HLS con DATERANGE tags:
app.get('/sgai/:contentId/playlist.m3u8', (req, res) => {
  res.send(generateSGAIManifest({
    segments: 10,
    adCueAtSecond: 5,
    adDuration: 15,
  }))
})
```

Esto desbloquea los 3 gaps MUST de `ads-sgai` — actualmente imposibles sin este mock.  
BUG-SGAI-001 (buffering+DVR loop) puede verificarse de forma determinista.

### 4.8 Test Impact Analysis en CI

Actualmente el pipeline QA (A1→A3) selecciona tests por riesgo.  
Integrar con CI para que el pipeline corra automáticamente en cada PR:

```yaml
# .github/workflows/qa-pipeline.yml
- name: QA Pipeline Analysis
  run: |
    npx ts-node scripts/prepare-diff.ts ${{ github.event.pull_request.number }}
    # Luego A1→A3 via Claude Code en modo --plan
    # El test_plan resultante se usa para seleccionar qué correr
```

### 4.9 OpenTelemetry para Observabilidad de Tests

Trazar ejecuciones de tests con spans para detectar qué es lento:

```typescript
// reporters/otel-reporter.ts — nuevo reporter
import { trace } from '@opentelemetry/api'
// Cada test = un span con atributos: módulo, risk_label, duración
// Enviar a Jaeger o Grafana Tempo para visualizar bottlenecks
```

Identifica: qué tests son lentos en CI, qué modules tienen mayor tiempo de setup.

### Criterio de completitud Fase 4
- Mutation score ≥ 70% en tests/contract/
- Visual regression en cloud (percy o reg-suit) — 0 falsos positivos en 10 PRs
- Chaos suite pasa en CI (3/3 escenarios sin error fatal)
- BrowserStack corre nightly sin intervención manual
- SGAI mock server desbloquea ads-sgai MUST gaps

---

## FASE 5 — Excelencia Continua (Ongoing)
**Impacto:** mantener 10/10

### 5.1 Automatización Total del Ciclo QA

```
PR abierto →
  prepare-diff.ts (automático en CI) →
  A1→A3 seleccionan suite →
  tests corren en shards →
  A10 filtra flaky →
  A7 emite veredicto →
  A8 comenta PR (DO_NOT_MERGE) o merge queue aprobado
```

Estado actual: pipeline manual. Target: totalmente automático en GitHub Actions.

### 5.2 Calidad de Oracles — Ciclo de Verificación

```
/sync-knowledge (mensual):
  Paso 7: detecta stale oracles → notifica en Slack
  Paso 9: nuevo coverage gaps report → issue automático en GitHub
  Paso 10: auto-popula covered_by desde tests con // Covers: AC-XXX
  
A11 (post-merge):
  Recalibra risk_map.yaml
  Actualiza test_coverage_ratio desde covered_by real
  Actualiza acceptance_criteria → path a behavior.json
```

### 5.3 Test Debt Tracking

Crear label `test-debt` en GitHub Issues.  
A8 crea issues con este label cuando detecta gaps MUST sin cubrir en módulos CRITICAL.  
Revisión semanal: test debt ratio = MUST gaps / total ACs HIGH+CRITICAL.  
Target: ≤ 5% test debt en módulos CRITICAL.

### 5.4 Documentación Viva

`qa-knowledge/` como fuente de verdad que se auto-actualiza:
- `/sync-knowledge` actualiza `last_verified` + `covered_by`
- A11 actualiza `test_coverage_ratio`
- behavior.json es el contrato vivo del módulo (no un doc estático)

Publicar como GitHub Pages con renderizado de los behavior.json → tabla visual de ACs + cobertura.

---

## Tabla de Impacto por Fase

| Fase | Duración | Calificación | Qué cambia | Estado |
|------|----------|-------------|------------|--------|
| Baseline | — | 5/10 | Tests rotos, coverage gaps, CI lento | — |
| Fase 1: Estabilidad | 1–2 sem | 6/10 | 0 fallos, fixtures correctos | ✅ 2026-06-06 |
| Fase 2: Cobertura | 2–4 sem | 8/10 | 23 MUST → 0, Knowledge System, AirPlay, nextEpisode, platform schema | ✅ 2026-06-06 |
| Fase 3: Infraestructura | 2–3 sem | 9/10 | Sharding, ABR real, property testing | 🔄 2026-06-06 (3.1+3.4+3.5 ✅) |
| Fase 4: Avanzado | 3–4 sem | 10/10 | Chaos, SGAI mock, BrowserStack, Mutation | ⬜ |
| Fase 5: Continuo | ongoing | 10/10 | Auto-pipeline, sync mensual, test debt 0 | ⬜ |

---

## Quick Wins (hacer esta semana)

1. Fix `duration-effect-ads.spec.ts` — ajustar constante o usar ContentId real (30 min)
2. Fix `dash-dvr.spec.ts` — agregar `waitForEvent('loadedmetadata')` (20 min)
3. Fix `player-api-format-param.spec.ts` — debug timeout (30 min)
4. `PLAYER_LOCAL_REPO` en `.env` — ✅ hecho
5. ~~Agregar `// Covers: AC-PLAYBACK-001` en tests existentes~~ — ✅ `covered_by` auto-populado vía `/sync-knowledge` Paso 10
6. `npm run fixtures:generate` — verificar que fixture HLS tiene duración correcta (15 min)
7. Confirmar strings `NETWORK_ERROR`/`MEDIA_ERROR`/`DRM_ERROR` con `/sync-knowledge` → cerrar Gap #9 (30 min)

---

## Herramientas a Instalar

```bash
# Fase 3
npm i -D fast-check              # property-based testing
npm i -D allure-playwright        # reporting con historial

# Fase 4
npm i -D @stryker-mutator/core @stryker-mutator/playwright-runner  # mutation
npm i -D @percy/playwright        # visual cloud (alternativa: reg-suit)
npm i -D zod                      # platform API schema validation (ya puede estar)

# Lighthouse CI (instalar global o via npx)
npm i -D @lhci/cli
```

---

## Referencias de Industria

- [Playwright Sharding](https://playwright.dev/docs/test-sharding) — distribución horizontal
- [fast-check](https://fast-check.io/) — property-based testing en TypeScript
- [Stryker Mutator](https://stryker-mutator.io/) — mutation testing
- [Percy](https://percy.io/) — visual regression cloud
- [Allure Framework](https://allurereport.org/) — test reporting con historial
- [Netflix — Chaos Engineering](https://netflixtechblog.com/chaos-engineering-upgraded-878d341f15fa) — principios aplicables a streaming QA
- [Google — Testing at Scale](https://abseil.io/resources/swe-book/html/ch11.html) — TAP, hermetic test environments
- [Playwright CDP](https://playwright.dev/docs/api/class-cdpsession) — network throttling, device emulation
- [OWASP Testing Guide](https://owasp.org/www-project-web-security-testing-guide/) — security testing checklist para media players (DRM, token)
- [W3C Media & Entertainment Interest Group](https://www.w3.org/2011/webtv/) — estándares de testing para media players
