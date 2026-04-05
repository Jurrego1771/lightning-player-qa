# CLAUDE.md — Lightning Player QA

Guía de contexto para Claude Code en este proyecto.
**Lee esto completo al inicio de cada sesión antes de hacer cualquier cosa.**

---

## 1. Identidad del Proyecto

| Campo | Valor |
|---|---|
| **Proyecto** | `lightning-player-qa` |
| **Propósito** | Suite de automatización de QA para Mediastream Lightning Player |
| **Tipo** | Proyecto independiente — no es parte del repo del player |
| **Stack** | Playwright 1.59 · TypeScript · axe-core · Express (mock VAST) |
| **Repo QA** | `D:\Dev\Repos\jurrego1771\lightning-player-qa` |
| **Repo Player (SUT)** | `D:\Dev\Repos\mediastream\lightning-player` |
| **Git user** | jurrego1771 |

---

## 2. Sistema Bajo Test (SUT)

El **Mediastream Lightning Player** es un reproductor multimedia HTML5 desarrollado por Mediastream.
Versión actual: `1.0.56`. Branch de desarrollo: `develop`.

### Qué soporta

- **Formatos de stream:** HLS (hls.js), MPEG-DASH (dash.js), HTML5 nativo (MP4, WebM, MP3)
- **Tipos de contenido:** VOD, Live, DVR, Audio, Radio, Reels, Podcast
- **DRM:** Widevine, PlayReady, FairPlay
- **Ads:** Google IMA (VAST/VMAP), Google DAI, Google SGAI, AWS MediaTailor, AdSwizz, ITG
- **Analytics:** Mediastream Tracker, Google Analytics 4, Comscore, StreamMetrics
- **Extras:** Chromecast, multi-instancia, PiP, federation/login, live reactions

### API pública (lo que usamos en tests)

```js
player.play()              // iniciar reproducción
player.pause()             // pausar
player.currentTime         // getter/setter — posición actual / seek
player.duration            // duración total
player.volume              // getter/setter — volumen 0-1
player.status              // 'playing' | 'pause' | 'buffering'
player.isPlayingAd()       // boolean
player.destroy()           // destruir instancia
```

Eventos via `window.postMessage` (prefijo `msp:`):
`ready`, `play`, `playing`, `pause`, `seeking`, `seeked`, `ended`, `error`,
`buffering`, `waiting`, `levelchanged`, `adsStarted`, `adsComplete`,
`adsAllAdsCompleted`, `adsError`, `adsContentPauseRequested`, `adsContentResumeRequested`

### Inicialización del player

```js
// Opción A: data-attributes en el script tag
// Opción B: API imperativa
window.loadMSPlayer('container-id', {
  type: 'media',     // 'live' | 'dvr' | 'media' | 'audio' | 'radio' | 'reels' | 'podcast'
  src: 'https://...',
  autoplay: false,
  ads: { map: 'https://vast-server/tag' }
})
```

**CRÍTICO:** El player hace requests a `embed.mdstrm.com` para cargar config remota.
En tests hay que interceptar estas o usar un harness que pase config inline.
Preguntar al usuario cómo está configurado el harness si no está documentado.

---

## 3. Filosofía de Testing

### Los 5 Principios — No Negociables

1. **No mockear el browser.** HLS, DASH, MSE, EME requieren APIs nativas reales.
   Tests E2E e integration corren en browsers reales via Playwright.

2. **Determinismo sobre cobertura.** 50 tests estables > 200 flaky.
   Live streams son no-deterministas; usar Chaos Proxy o streams de test controlados.

3. **Observar desde afuera.** Solo API pública del player.
   Nunca importar código del repo del player. Nunca depender de clases CSS internas.

4. **Separar capas.** Cada test valida una sola cosa.
   E2E ≠ integration ≠ performance. No mezclar.

5. **Test data controlada.** Nunca streams de producción en tests automáticos.
   Ver `fixtures/streams.ts` para el catálogo de streams de test aprobados.

### Pirámide de Testing

```
                 ┌────────────────────┐
                 │   Cross-Device      │  Bitmovin Stream Lab / BrowserStack (release)
               ┌─┴────────────────────┴─┐
               │  Visual + A11y         │  Playwright screenshots + axe-core (por PR)
             ┌─┴──────────────────────────┴─┐
             │       E2E Tests               │  Playwright 3 browsers (por PR)
           ┌─┴───────────────────────────────┴─┐
           │     Integration Tests              │  Playwright + Chaos Proxy + mock VAST (PR)
         ┌─┴──────────────────────────────────────┴─┐
         │          Unit Tests                        │  Vitest — en el repo del player
         └────────────────────────────────────────────┘
```

---

## 4. Estructura del Proyecto

```
lightning-player-qa/
├── CLAUDE.md                    ← Este archivo — leer primero
├── .claude/
│   ├── settings.json            ← Hooks de Claude Code (session end reminder)
│   └── memory/
│       ├── MEMORY.md            ← Índice de memoria persistente
│       ├── project_context.md
│       ├── player_system.md
│       ├── testing_philosophy.md
│       ├── decisions.md
│       └── sessions/            ← Aprendizajes por sesión (se crean dinámicamente)
├── fixtures/
│   ├── index.ts                 ← Punto de entrada (exporta test + fixtures)
│   ├── player.ts                ← Page Object del player (toda la interacción va aquí)
│   └── streams.ts               ← Catálogo de streams de test + NetworkProfiles
├── helpers/
│   ├── qoe-metrics.ts           ← CDP, startup time, session metrics
│   └── network-conditions.ts    ← withNetworkCondition(), blockHost(), addLatency()
├── mock-vast/
│   ├── server.ts                ← Servidor Express que sirve XMLs VAST
│   └── responses/               ← preroll.xml, empty.xml, error-303.xml, etc.
├── tests/
│   ├── e2e/                     ← Flujos completos de usuario
│   ├── integration/             ← HLS/DASH + mock streams + ad beacons
│   ├── visual/                  ← Screenshots de UI (baseline)
│   ├── a11y/                    ← axe-core + WCAG 2.1 AA
│   └── performance/             ← QoE metrics con CDP
├── agents/                      ← Agentes de IA (expandir en el futuro)
├── skills/                      ← Skills de Claude Code (expandir en el futuro)
├── playwright.config.ts         ← Config principal (Tier 1)
├── playwright.browserstack.config.ts ← Tier 2 nightly
└── .env.example                 ← Variables de entorno necesarias
```

---

## 5. Comandos Clave

```bash
# Instalar dependencias
npm install

# Instalar browsers de Playwright (solo primera vez)
npx playwright install chromium firefox webkit

# Correr todos los tests Tier 1 (para CI/PR)
npm run test:ci

# Correr por tipo
npm run test:e2e
npm run test:integration
npm run test:visual
npm run test:a11y
npm run test:performance

# Correr un spec específico
npx playwright test tests/e2e/vod-playback.spec.ts

# Correr con UI mode (debugging visual)
npx playwright test --ui

# Actualizar baseline de visual regression
npm run test:update-snapshots

# Ver reporte HTML del último run
npm run report

# Iniciar mock VAST server (necesario para tests de ads)
npm run mock-vast:start

# Correr en BrowserStack (Tier 2)
npm run test:nightly
```

---

## 6. Variables de Entorno

Copiar `.env.example` a `.env` y completar:

```bash
cp .env.example .env
```

Variables críticas:
- `PLAYER_BASE_URL` — URL base donde está desplegado el player
- `MOCK_VAST_PORT` — Puerto del mock VAST server (default: 9999)
- `BROWSERSTACK_USERNAME` / `BROWSERSTACK_ACCESS_KEY` — para Tier 2

**NUNCA commitear `.env` al repositorio.**

---

## 7. Cómo Escribir un Test

### Regla de oro: siempre importar desde `fixtures/`

```typescript
// ✅ Correcto
import { test, expect, Streams } from '../../fixtures'

// ❌ Incorrecto — no usar @playwright/test directamente
import { test } from '@playwright/test'
```

### Estructura de un test E2E

```typescript
import { test, expect, Streams } from '../../fixtures'

test.describe('Feature X', () => {
  test('comportamiento esperado bajo condición Y', async ({ player, page }) => {
    // 1. Arrange — cargar el player con config mínima
    await player.goto({ type: 'media', src: Streams.hls.vodShort, autoplay: true })
    await player.waitForReady()

    // 2. Act — interacción
    await player.seek(30)
    await player.waitForEvent('seeked')

    // 3. Assert — verificar resultado
    await player.assertCurrentTimeNear(30, 1)
    await player.assertIsPlaying()
  })
})
```

### Anti-patrones a evitar

```typescript
// ❌ No usar clases CSS internas del player
page.locator('.msp-button-play--active')  // Puede cambiar

// ✅ Usar aria-labels o API pública
page.locator('[aria-label="Play"]')
await player.assertIsPlaying()

// ❌ No usar timeouts arbitrarios para "esperar"
await page.waitForTimeout(5000) // Frágil

// ✅ Usar eventos o expect.poll
await player.waitForEvent('playing')
await expect.poll(() => player.getStatus()).toBe('playing')

// ❌ No asumir que el stream de test siempre estará disponible
// ✅ Usar test.skip condicionalmente si el stream falla
```

---

## 8. Flujos Críticos (Prioridad de Testing)

### Prioridad Crítica — Bloquea release si falla

1. Init → Load → Play (VOD HLS y DASH)
2. Pre-roll ad → content pause → ad complete → content resume
3. HLS ABR bajo bandwidth degradado
4. Error de red → retry → recovery
5. DRM Widevine VOD en Chrome

### Prioridad Alta

6. DVR seek en stream live
7. Mid-roll trigger en cue point correcto
8. Selección de audio track (multi-idioma)
9. Google DAI — stream con ads en manifest
10. Destroy → no memory leak

### Prioridad Media

11. Radio view con nowplaying metadata
12. Next episode flow
13. Ad blocker detection
14. AWS MediaTailor DAI
15. Chromecast session básica

---

## 9. Session Protocol — OBLIGATORIO

### Al inicio de cada sesión

1. **Lee `MEMORY.md`** en `.claude/memory/` para entender el estado actual
2. **Verifica** que los archivos referenciados en la memoria siguen siendo válidos
3. **Pregunta al usuario** qué quiere lograr en esta sesión antes de empezar
4. Si hay tareas pendientes documentadas, confirma cuáles abordar

### Durante la sesión

- Toma nota mental de:
  - Comportamientos del player que descubres y no estaban documentados
  - Decisiones técnicas que tomas y por qué
  - Problemas que encuentras y cómo los resuelves
  - Streams de test que no funcionan

### Al final de cada sesión

**Antes de terminar, responde estas preguntas y guarda los learnings:**

1. ¿Qué aprendiste del player o del sistema de testing que sea no-obvio?
2. ¿Tomaste decisiones técnicas importantes? ¿Por qué?
3. ¿Hubo algo que no funcionó como esperabas?
4. ¿Hay tareas que quedaron pendientes para la próxima sesión?

**Cómo guardar:**
- Si es un aprendizaje de sesión → crear `sessions/YYYY-MM-DD_tema.md`
- Si es una decisión técnica → agregar a `decisions.md`
- Si corrige información del player → actualizar `player_system.md`
- Si es feedback de proceso → actualizar `testing_philosophy.md`
- **Siempre** actualizar `MEMORY.md` con el nuevo puntero

```markdown
<!-- Formato para sessions/YYYY-MM-DD_tema.md -->
---
name: Aprendizaje — [Tema]
description: [Una línea descriptiva]
type: project
---

# [Tema] — [Fecha]

## Qué aprendimos
...

## Decisiones tomadas
...

## Pendiente para próxima sesión
...
```

---

## 10. Integración de Agentes y Skills

### Estado actual

El proyecto está preparado para escalar con agentes y skills de Claude Code.
Los directorios `agents/` y `skills/` existen con sus READMEs.

### Cómo agregar un agente

1. Crear directorio `agents/nombre-agente/`
2. Crear `agents/nombre-agente/agent.ts` con la lógica
3. Documentar en `agents/README.md`
4. Actualizar `MEMORY.md` con referencia

### Cómo agregar un skill

1. Crear `skills/nombre-skill.md` con frontmatter YAML
2. El cuerpo del archivo es el prompt del skill
3. Si el skill necesita permisos especiales, actualizar `.claude/settings.json`
4. Documentar en `skills/README.md`

### Agentes prioritarios para implementar (en orden)

1. `flaky-analyzer` — detecta tests intermitentes en reportes de CI
2. `test-generator` — genera specs nuevos dado un flujo descrito en lenguaje natural
3. `qoe-reporter` — compara métricas QoE entre dos versiones del player
4. `stream-monitor` — verifica que los streams de test estén disponibles

---

## 11. Importante: Lo que NO está en scope aquí

- **Unit tests** → van en el repo del player (`D:\Dev\Repos\mediastream\lightning-player`)
  Usar Vitest. Candidatos: `src/ads/manager/`, `src/helper/`, `src/events/`

- **Tests del backend/plataforma** → otro repo

- **Tests de producción (real users)** → analytics del player en producción

---

## 12. Preguntas Frecuentes

**¿Cómo sé si un test está fallando por el player o por el stream de test?**
→ Cambiar el stream por otro del catálogo y correr de nuevo.
Si falla con todos los streams, es el player. Si solo falla con uno, es el stream.

**¿Qué hago si el player no expone via API algo que necesito testear?**
→ Documentarlo aquí y proponer al equipo del player que lo expongan.
No acceder a internals. No es negociable.

**¿Cómo testeo FairPlay DRM?**
→ Requiere Safari en macOS real (no simulado). Tier 2 en BrowserStack con macOS + Safari.
En CI no se puede (Playwright WebKit no es Safari real y no tiene CDM FairPlay).

**¿Qué hacer si un stream de test deja de funcionar?**
→ Actualizar `fixtures/streams.ts` con una alternativa.
No cambiar el test para trabajar sin el stream. Documentar en `decisions.md`.

**¿Cómo correr solo los tests de un área?**
→ `npx playwright test tests/e2e/` o `npx playwright test --grep "Ad Beacons"`
