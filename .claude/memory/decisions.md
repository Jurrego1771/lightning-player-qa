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

## 2026-04-05 — Estrategia multi-ambiente: dev diario, staging/prod smoke

**Decisión:** Tres ambientes con estrategias diferentes.

**URLs reales:**
- `prod`:    `https://player.cdn.mdstrm.com/lightning_player/api.js`
- `dev`:     `https://player.cdn.mdstrm.com/lightning_player/develop/api.js`
- `staging`: `https://player.cdn.mdstrm.com/lightning_player/staging/api.js`

**Workflows creados:**
- `dev-daily.yml` → cron `0 12 * * 1-5` (7 AM Colombia, Lunes-Viernes) + push a main
- `staging-smoke.yml` → solo manual o `repository_dispatch: staging-deploy`
- `prod-smoke.yml` → solo manual o `repository_dispatch: prod-deploy`

**Why:** La mayoría de bugs se encuentran en dev. Staging es un double-check pre-prod.
Prod solo necesita verificar que el deploy no rompió lo básico.

**How to apply:** Seleccionar ambiente con `PLAYER_ENV=dev|staging|prod`. Ver `config/environments.ts`.
La variable controla qué script URL se carga en el harness y qué suite de tests corre.

---

## 2026-04-05 — Estrategia de mocking: isolatedPlayer para integration/visual/a11y

**Decisión:** Tests de integración, visual y a11y usan `isolatedPlayer` fixture que intercepta
la plataforma Mediastream con `page.route()` y apunta los streams a HLS fixtures locales.

**Arquitectura:**
- `page.route('**/develop.mdstrm.com/**')` intercepta todas las requests a la plataforma
- `fixtures/platform-responses/content/vod.json` devuelve `src.hls = http://localhost:9001/vod/master.m3u8`
- Los streams HLS se generan con ffmpeg (script `generate-fixtures.sh`) usando fuentes sintéticas (testsrc, sine)
- `webServer` en `playwright.config.ts` levanta `npx serve fixtures/streams -p 9001`
- `MockContentIds.vod = 'mock-vod-1'` — IDs ficticios para tests aislados

**Why:** Basado en cómo Shaka Player (50+ carpetas fixtures), Netflix VMAF y dash.js
usan streams locales deterministas. Los tests de CDN son frágiles: el CDN puede cambiar
la bitrate, caerse, o devolver contenido diferente. Con streams locales:
- No hay flakiness por latencia de red
- Los screenshots de visual regression siempre muestran el mismo frame
- ABR con throttling CDP es reproducible (el stream siempre tiene 2 calidades conocidas)
- Los tests de a11y corren sin dependencia de plataforma

**Tests que NO se aíslan:** E2E, smoke, performance — estos prueban la integración real
con la plataforma y CDN, que es el propósito de esos test tiers.

**How to apply:**
- Integration/visual/a11y → usar `isolatedPlayer` + `MockContentIds`
- E2E/smoke/performance → usar `player` + `ContentIds` (IDs reales de DEV)

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
