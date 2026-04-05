---
name: Contexto del Proyecto QA
description: Qué es lightning-player-qa, scope, objetivos, estado de implementación y relación con el player repo
type: project
---

# Lightning Player QA — Contexto del Proyecto

**Proyecto:** `lightning-player-qa`
**Repositorio player (SUT):** `D:\Dev\Repos\mediastream\lightning-player`
**Repositorio QA (este):** `D:\Dev\Repos\jurrego1771\lightning-player-qa`

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

## Estado del Proyecto

- Fase: **Setup inicial completado** — 2026-04-05
- Estructura de directorios: lista
- Dependencias instaladas: Playwright 1.59.1, axe-core, TypeScript, Express (mock VAST)
- Primer commit: pendiente

## Relación con el Player

- Este proyecto interactúa con el player **solo via API pública** (play, pause, currentTime, eventos)
- Nunca importa código del repo del player
- Para entender el player, ver `player_system.md`

## Próximos Pasos

**Why:** El proyecto necesita un harness HTML para que Playwright pueda cargar el player
**How to apply:** Antes de correr tests, se necesita definir cómo se sirve el player en test.
La opción A es apuntar a una URL de staging. La opción B es un harness local.
