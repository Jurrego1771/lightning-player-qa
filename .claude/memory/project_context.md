---
name: Contexto del Proyecto QA
description: Qué es lightning-player-qa, scope, objetivos, estado de implementación y relación con el player repo
type: project
---

# Lightning Player QA — Contexto del Proyecto

**Proyecto:** `lightning-player-qa`
**Repositorio player (SUT):** `$PLAYER_LOCAL_REPO` (configurar en `.env` — varía por máquina)
**Repositorio QA (este):** `D:\repos\jurrego1771\lightning-player-qa`

## Qué es

Proyecto de automatización de QA **independiente** del repositorio del player.
Contiene todos los tests automatizados excepto unit tests (que se sugieren al repo del player).

## Scope

| Tipo de Test | Dónde | Estado |
|---|---|---|
| Unit tests | En el repo del player (sugeridos) | No implementados aún |
| E2E tests | Este repo / tests/e2e/ | Base creada |
| Integration tests | Este repo / tests/integration/ | Base creada |
| Visual regression | Este repo / tests/visual/ | Base creada |
| Accessibility | Este repo / tests/a11y/ | Base creada |
| Performance/QoE | Este repo / tests/performance/ | Base creada |
| Cross-device (BrowserStack) | Este repo / playwright.browserstack.config.ts | Config creada |
| Stream validation (canary) | Pendiente | No implementado |

## Ambientes

| Env | PLAYER_ENV | Script URL | Uso |
|---|---|---|---|
| Development | `dev` | `.../develop/api.js` | Pruebas diarias (default) |
| Staging | `staging` | `.../staging/api.js` | Smoke post-deploy, raro |
| Producción | `prod` | `.../api.js` | Smoke post-deploy prod |

Selección: variable `PLAYER_ENV=dev|staging|prod` (ver `config/environments.ts`)

## Harness

El harness es `harness/index.html` — cargado via `page.setContent()` en `fixtures/player.ts`.
No requiere servidor local. El script del player se inyecta desde CDN según el ambiente.

## Estado del Proyecto

- Fase: **Análisis y corrección de supuestos** — 2026-04-08
- Estructura de directorios: lista
- Dependencias instaladas: Playwright 1.59.1, axe-core, TypeScript, Express (mock VAST)
- Commits: db06b6d (setup inicial) + multi-ambiente + mocking strategy
- Player SUT versión: **1.0.58** (QA inicialmente documentaba 1.0.56)

## Relación con el Player

- Este proyecto interactúa con el player **solo via API pública** (play, pause, currentTime, eventos)
- Nunca importa código del repo del player
- Para entender el player, ver `player_system.md`

## Próximos Pasos

**Pendiente:** Verificar que `window.__initPlayer` en el harness coincide con cómo
el player real expone su API (puede requerir ajuste una vez que se pruebe contra dev real).
**Why:** El harness asume `new MediastreamPlayer(id, config)` pero no hemos corrido tests reales aún.
**How to apply:** Primera sesión de ejecución de tests, validar con jurrego1771.
