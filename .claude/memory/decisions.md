---
name: Decisiones Técnicas
description: Registro de decisiones arquitecturales y técnicas con su justificación
type: project
---

# Decisiones Técnicas — Lightning Player QA

## 2026-04-05 — Playwright como framework principal

**Decisión:** Usar Playwright (no Cypress, no WebdriverIO, no Selenium).

**Why:** JW Player usa WebdriverIO para cross-browser + mobile. Pero para este proyecto
el foco inicial es web (Chrome + Firefox + Safari) donde Playwright es superior:
- Multi-browser nativo (Chromium, Firefox, WebKit) en un solo proceso
- CDP disponible para network throttling y métricas (esencial para QoE tests)
- Video recording de runs fallidos built-in
- Network interception para beacons de ads sin dependencies extras
- El equipo puede escalar a WebdriverIO/Appium si se necesita iOS/Android nativo real

**How to apply:** Usar siempre `@playwright/test`. Si en el futuro se necesita iOS nativo
(FairPlay DRM en dispositivo real), evaluar agregar WebdriverIO en paralelo.

---

## 2026-04-05 — Mock VAST server propio (no dependencia externa)

**Decisión:** Servidor Express local que sirve XMLs VAST controlados.

**Why:** Los test ad tags de Google IMA son públicos pero su respuesta puede cambiar.
Un mock server local da control total: simular VAST vacío, error 303, pod de 3 ads,
sin depender de conectividad a Google y sin disparar beacons reales en CI.

**How to apply:** Iniciar `mock-vast/server.ts` en `globalSetup` de Playwright
antes de correr tests de ads.

---

## 2026-04-05 — Page Object que habla solo la API pública del player

**Decisión:** `fixtures/player.ts` no accede a internos del bundle, solo a la API pública.

**Why:** El player puede cambiar su estructura interna entre versiones. Si los tests
dependen de clases CSS internas o estructura del DOM del player, se rompen en cada release.
La API pública (play, pause, currentTime, eventos) es el contrato estable.

**How to apply:** Si el player no expone algo via API pública y necesitamos testearlo,
proponer al equipo del player que lo expongan. Documentar en este archivo.

---

## 2026-04-05 — Separación Tier 1 (PR) / Tier 2 (Nightly) / Tier 3 (Release)

**Decisión:** No todos los tests corren en cada PR.

**Why:** Los tests de BrowserStack (Tier 2) son lentos y costosos.
Los tests en TV/Console (Tier 3) requieren hardware físico o Stream Lab.
En cada PR solo corren E2E en 3 browsers + integration + visual + a11y (Tier 1).

**How to apply:**
- `npm run test:ci` → Tier 1 (para CI/PR)
- `npm run test:nightly` → Tier 2 (para cron nocturno)
- Tier 3 es manual + Bitmovin Stream Lab API (configurar cuando se contrate)
