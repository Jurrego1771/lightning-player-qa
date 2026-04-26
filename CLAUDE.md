# CLAUDE.md — Lightning Player QA

Guía corta de entrada para Claude Code en este proyecto.

## Estado actual

Este archivo ya no debe ser la fuente principal de verdad. El conocimiento versionado vive en `docs/`.

Leer primero:
- [docs/00-index/README.md](D:\Dev\Repos\jurrego1771\lightning-player-qa\docs\00-index\README.md:1)
- [docs/01-sut/overview.md](D:\Dev\Repos\jurrego1771\lightning-player-qa\docs\01-sut\overview.md:1)
- [docs/01-sut/observability-model.md](D:\Dev\Repos\jurrego1771\lightning-player-qa\docs\01-sut\observability-model.md:1)
- [docs/03-testing/philosophy.md](D:\Dev\Repos\jurrego1771\lightning-player-qa\docs\03-testing\philosophy.md:1)
- [docs/03-testing/assertion-rules.md](D:\Dev\Repos\jurrego1771\lightning-player-qa\docs\03-testing\assertion-rules.md:1)
- [docs/05-pipeline/ai-test-generation/contract.md](D:\Dev\Repos\jurrego1771\lightning-player-qa\docs\05-pipeline\ai-test-generation\contract.md:1)

Regla dura:
- No generar tests nuevos sin `feature-spec`, `business-rules`, `observability`, `edge-cases`, `test-strategy` y `test brief`.

Para una feature concreta, usar primero su carpeta en `docs/02-features/`.

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
Versión actual: `1.0.62`. Branch de desarrollo: `develop`.

### Qué soporta

- **Formatos de stream:** HLS (hls.js), MPEG-DASH (dash.js — sin soporte nativo en browsers, siempre via dashjs), HTML5 nativo (MP4, WebM, MP3)
- **Tipos de contenido:** VOD, Live, DVR, Audio, Radio, Reels, Podcast
- **DRM:** Widevine, PlayReady, FairPlay
- **Ads:** Google IMA (VAST/VMAP), Google DAI, Google SGAI, AWS MediaTailor, AdSwizz, ITG
- **Analytics:** Mediastream Tracker, Google Analytics 4, Comscore, StreamMetrics
- **Extras:** Chromecast, multi-instancia, PiP, federation/login, live reactions

### API pública (lo que usamos en tests)

```js
// Playback
player.play()              // iniciar reproducción
player.pause()             // pausar
player.destroy()           // destruir instancia y desmontar React

// Estado y posición
player.status              // 'playing' | 'pause' | 'buffering' | 'idle'
player.currentTime         // getter/setter — posición actual en segundos / seek
player.duration            // duración total en segundos
player.paused              // boolean
player.loop                // getter/setter — boolean
player.playbackRate        // getter/setter — velocidad de reproducción

// Audio / video
player.volume              // getter/setter — 0 a 1
player.muted               // getter/setter — boolean
player.videoWidth          // ancho del video en píxeles (solo video handler)
player.videoHeight         // alto del video en píxeles (solo video handler)

// Stream
player.isLive              // boolean — true si type='live'
player.isDVR               // boolean — true si type='dvr'
player.seekable            // TimeRanges — rango seekable (útil en DVR)
player.edge                // número — posición del live edge (segundos)
player.handler             // 'hls' | 'dash' | 'native' — handler activo
player.version             // string — versión del player (ej: '1.0.62')

// ABR (HLS.js)
player.level               // nivel de calidad activo (-1 = auto)
player.nextLevel           // nivel solicitado (puede diferir de level durante cambio)
player.levels              // array de niveles disponibles
player.bitrate             // bitrate del nivel activo
player.bandwidth           // bandwidth estimado

// Ads
player.isPlayingAd()       // boolean — true si hay ad reproduciéndose
player.ad.info             // AdInfo | null — info del ad activo
player.ad.cuePoints        // number[] — tiempos de mid-rolls

// Metadata
player.metadata            // object — metadata del contenido (reels, radio, etc.)
player.type                // string — tipo de contenido ('media', 'live', etc.)

// Tracks
player.textTracks          // TextTrackList — subtítulos
player.audioTracks         // AudioTrackList — pistas de audio

// Next episode
player.updateNextEpisode(data)  // fuerza carga del siguiente episodio con datos
player.keepWatching()           // cancela auto-carga del siguiente episodio
player.playNext()               // carga el siguiente episodio inmediatamente

// Dynamic load
player.load({ type, id })  // carga nuevo contenido sin destruir la instancia
```

**Eventos player.on() — los más relevantes:**
```
ready             — player listo (siempre se emite al init)
loaded            — config de plataforma cargada
sourcechange      — src cambió (se emite en player.load())
playing           — reproducción activa
play              — transición a playing iniciada
pause             — reproducción pausada
ended             — contenido terminó
seeking / seeked  — seek iniciado / completado
buffering         — buffering activo
error             — error de cualquier tipo
contentFirstPlay  — primera reproducción del contenido (analytics crítico)
levelchanged      — cambio de calidad ABR confirmado
metadataloaded    — metadata del contenido disponible
metadatachanged   — metadata actualizada (nowplaying en radio)
adsImpression     — ad impression registrada
adsStarted        — ad iniciado
adsComplete       — ad completado
adsAllAdsCompleted — todos los ads del break completados
adsError          — error en ads
adsContentPauseRequested / adsContentResumeRequested — content pause/resume por ad
```

### Inicialización del player

Tres métodos documentados (ver `harness/` para implementaciones de referencia):

```js
// Método 1 — loadMSPlayer() Promise (principal — usado en harness/index.html)
window.loadMSPlayer('container-id', {
  type: 'media',    // 'live' | 'dvr' | 'media' | 'audio' | 'radio' | 'reels' | 'podcast'
  id: 'content-id',
  autoplay: false,
  adsMap: 'https://vast-server/tag',  // VAST tag URL (camelCase de data-ads-map)
  // ads: { map: 'url' }             // forma alternativa también funciona
}).then(player => { /* ... */ })

// Método 2 — data-loaded callback (harness/multi-init.html)
<script src="...api.js" data-container="div-id" data-type="media" data-id="..." data-loaded="myCallback"></script>
// → llama window.myCallback(player) cuando listo

// Método 3 — playerloaded CustomEvent (harness/multi-init.html)
script.addEventListener('playerloaded', ({ detail: player }) => { /* ... */ })
// → el script element emite el evento con player en event.detail
```

**CRÍTICO:** El player hace requests a `develop.mdstrm.com` (u otros subdominios según env) para cargar config remota.
En tests `isolatedPlayer` intercepta estos requests con `page.route()`. El dominio interceptado varía por ambiente — ver `fixtures/platform-mock.ts`.

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
│   ├── index.ts                 ← Punto de entrada (exporta test + fixtures — player e isolatedPlayer)
│   ├── player.ts                ← Page Object del player (toda la interacción va aquí)
│   ├── streams.ts               ← ContentIds, MockContentIds, LocalStreams, NetworkProfiles
│   ├── platform-mock.ts         ← setupPlatformMocks(), mockContentConfig(), mockContentError()
│   └── platform-responses/      ← JSON mock de content config y player config
│       ├── content/             ← vod.json, live.json, audio.json, error-403.json
│       └── player/              ← default.json, radio.json, compact.json
├── scripts/
│   └── generate-fixtures.sh     ← Genera streams HLS locales con ffmpeg (correr una vez)
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

## 5. Estrategia de Mocking (Decisión de Arquitectura)

El Lightning Player hace **dos requests** al inicializarse:
1. **Content config** → `GET develop.mdstrm.com/{type}/{id}.json?...` — devuelve src, DRM, ads, poster
2. **Player config** → `GET develop.mdstrm.com/{type}/{id}/player/{playerId}` — devuelve UI config

### Tabla de decisión: qué mockear y qué no

| Tipo de test | Plataforma | CDN / Streams | Herramienta |
|---|---|---|---|
| **Integration** | Mockeado (`page.route`) | Local (`localhost:9001`) | `isolatedPlayer` fixture |
| **Visual (screenshots)** | Mockeado | Local | `isolatedPlayer` fixture |
| **A11y (axe-core)** | Mockeado | Local | `isolatedPlayer` fixture |
| **E2E (flujos reales)** | Real (DEV) | Real CDN | `player` fixture + `ContentIds` |
| **Smoke** | Real (STAGING/PROD) | Real CDN | `player` fixture + `ContentIds` |
| **Performance (QoE)** | Real (DEV) | Real CDN | `player` fixture + `ContentIds` |

**Regla clave:**  
- `isolatedPlayer` → sin dependencias externas → determinista → CI rápido  
- `player` → contra infra real → valida integración end-to-end

### Fixtures HLS locales

Generados por `bash scripts/generate-fixtures.sh` (requiere ffmpeg):

```
fixtures/streams/
├── vod/
│   ├── master.m3u8     ← 2 calidades: 360p (400Kbps) + 720p (1.5Mbps)
│   ├── 360p/           ← segmentos .ts de 2s cada uno
│   └── 720p/
├── audio/
│   └── index.m3u8      ← audio AAC puro
└── vod-with-error/
    └── index.m3u8      ← playlist con segmento faltante (para recovery tests)
```

Servidos en CI por `webServer` en `playwright.config.ts` vía `npx serve -p 9001`.

### Mocks de plataforma

Ubicados en `fixtures/platform-responses/`:
- `content/vod.json` — config VOD, src.hls → localhost:9001/vod/master.m3u8
- `content/live.json` — config live stream
- `content/audio.json` — config audio
- `content/error-403.json` — simula acceso denegado
- `player/default.json` — UI config: view=video

### Uso en tests

```typescript
// Tests aislados (integration, visual, a11y)
import { test, expect, MockContentIds } from '../../fixtures'

test('caso aislado', async ({ isolatedPlayer }) => {
  // La plataforma está interceptada — no se habla con develop.mdstrm.com
  // El stream viene de localhost:9001 — no depende de CDN
  await isolatedPlayer.goto({ type: 'media', id: MockContentIds.vod, autoplay: true })
  await isolatedPlayer.assertIsPlaying()
})

// Tests E2E / smoke / performance (contra infra real)
import { test, expect, ContentIds } from '../../fixtures'

test('caso real', async ({ player }) => {
  await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: true })
  await player.assertIsPlaying()
})
```

### Override de mocks en un test específico

```typescript
import { mockContentConfig, mockContentError } from '../../fixtures'

test('error handling', async ({ page, isolatedPlayer }) => {
  // setupPlatformMocks ya corrió (fixture isolatedPlayer)
  // Pero podemos agregar un override específico para este test:
  await mockContentError(page, 403)
  await isolatedPlayer.goto({ type: 'media', id: 'mock-restricted', autoplay: true })
  await isolatedPlayer.waitForEvent('error', 15_000)
})
```

---

## 6. Comandos Clave

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

# Generar HLS fixtures locales (requiere ffmpeg — solo si no existen)
npm run fixtures:generate

# Servir HLS fixtures localmente (el webServer en playwright.config.ts lo hace automáticamente)
npm run fixtures:serve

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

## 13. SGAI — Bugs conocidos (Google Server-Guided Ad Insertion)

**Estado:** sin cobertura de tests (gap #5). Los siguientes bugs están documentados en el source
pero no tienen specs todavía.

- `useGoogleSGAILifecycle.js` — hook que gestiona el ciclo de vida SGAI. Hay casos edge
  donde el manifest con ads puede no recargar correctamente si el player está en estado buffering
  cuando llega la señal de ad-break.
- La interacción SGAI + DVR (live stream con DVR habilitado) no está testeada.
- Gap #5 en `testing_gaps.md`: archivo a crear = `tests/integration/sgai.spec.ts`

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
