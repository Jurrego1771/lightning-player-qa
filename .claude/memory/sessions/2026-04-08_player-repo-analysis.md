---
name: Análisis del Repositorio del Player
description: Hallazgos del análisis directo del código fuente de lightning-player v1.0.58 cruzado con el QA suite
type: project
---

# Análisis del Repo del Player — 2026-04-08

## Qué hicimos

Exploramos el repositorio `D:\repos\mediastream\lightning-player` (v1.0.58) completamente
y cruzamos lo encontrado con el estado actual del proyecto QA. Esta fue la primera vez
que verificamos la documentación QA contra el código fuente real del player.

## Hallazgos críticos (supuestos incorrectos en el QA)

### 1. DASH no usa dash.js — CORRECCIÓN IMPORTANTE

El CLAUDE.md y los docs del QA decían "MPEG-DASH (dash.js)".
**Realidad:** No existe dash.js en el proyecto. DASH usa `<video>` nativo del browser.
Esto invalida los tests de ABR para DASH en `qoe-metrics.spec.ts`.

### 2. Version del player desactualizada

El QA documentaba v1.0.56. El player ya está en v1.0.58 con cambios relevantes:
- SGAI refactorizado (bugs conocidos)
- DAI + DRM añadido
- Controls toggle

### 3. `ads.map` vs `adsMap`

El player acepta `ads: { map: 'url' }` como configuración de ads (equivalente a `data-ads-map`).
El QA usa `adsMap` como campo de nivel raíz en `InitConfig`. El harness debe remapaer esto.
Si no lo hace, los tests de ads pasan `adsMap` que el player ignora — falsos positivos.

### 4. Endpoint de plataforma según ambiente

- dev usa `develop.mdstrm.com`
- prod usa `embed.mdstrm.com`
El `page.route()` del `isolatedPlayer` fixture debe interceptar el dominio correcto.

## Arquitectura importante descubierta

- **React 18 + Jotai:** Estado reactivo asíncrono → los asserts deben ser siempre poll-based
- **hls.js 1.6.13:** ABR real solo para HLS, no DASH
- **Dos canales de eventos:** `player.on()` interno + `window.postMessage()` con prefijo `msp:`
- **Dynamic imports:** Los handlers y plugins cargan lazy → waitForReady() es crítico
- **Multi-instancia bug:** pLoader de SGAI es global, contamina instancias en la misma página

## Riesgos identificados (sin cobertura de tests)

1. **SGAI** — Feature nueva con 4 bugs conocidos en code review, 0 tests
2. **Multi-instancia** — Bug documentado en el código, 0 tests
3. **Contract de platform API** — Mocks estáticos pueden quedar desfasados
4. **Error types específicos** — Solo testeamos "hay error", no el tipo

## Decisiones tomadas en esta sesión

- Crear `player_system.md` actualizado con datos reales del código fuente
- Crear `player_architecture.md` con arquitectura interna relevante para QA
- Crear `testing_gaps.md` como registro vivo de lo que falta
- Crear skill `/sync-knowledge` para mantener esto actualizado
- NO corregir tests todavía — primero consolidar el conocimiento

## Pendiente para próxima sesión

1. Verificar interceptor de plataforma en `platform-mock.ts` (dominio correcto por ambiente)
2. Verificar que `harness/index.html` remapea `adsMap → ads.map`
3. Corregir `retries` en `playwright.config.ts`
4. Implementar tests de SGAI (prioridad alta)
5. Actualizar CLAUDE.md sección 2 con correcciones (DASH, version, eventos)
