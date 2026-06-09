# MEMORY INDEX — Lightning Player QA

Índice del sistema de memoria persistente. Máximo 200 líneas.

---

## Proyecto

- [Contexto del Proyecto](project_context.md) — scope, objetivos, ambientes
- [Filosofía de Testing](testing_philosophy.md) — principios, pirámide, qué NO hacer

## Sistema Bajo Test — Lightning Player

- [Sistema del Player — API pública](player_system.md) — **LEER PRIMERO.** API verificada desde código fuente v1.0.62: init, métodos, propiedades, eventos, ad systems, DRM.
- [Arquitectura Interna](player_architecture.md) — React+Jotai, hls.js internals, sistema de eventos, flujo de IMA, SGAI, por qué los asserts deben ser poll-based

## Decisiones Técnicas

- [Decisiones Registradas](decisions.md) — por qué elegimos X sobre Y, trade-offs aceptados

## Gaps y Cobertura Pendiente

- [Testing Gaps](testing_gaps.md) — **LEER ANTES DE ESCRIBIR TESTS.** Gaps sin cobertura, correcciones urgentes, supuestos incorrectos.

---

## Variables de entorno críticas

- `PLATFORM_API_TOKEN` — token hex del API admin de Mediastream. Sin él, tests de live se saltean.
- `PLATFORM_API_URL` — default `https://dev.platform.mediastre.am/api`
- `PLAYER_GITHUB_REPO` — repo del player en GitHub (ej: `mediastream/lightning-player`) — requerido por `analyze-diff.ts`

## Sistemas de Automatización Implementados

- **analyze-diff.ts** — `npm run diff:analyze [PR|branch|commit]`. Fase A1 del pipeline. Fetch via @octokit/rest, fallback local via simple-git. Produce risk-map.json schema v3.0 + coverage-report.json en ~5s.
- **Performance trend tracking** — `helpers/perf-storage.ts` + `scripts/compare-perf.ts`
- **Flaky test detection** — `reporters/flakiness-reporter.ts` + `scripts/analyze-flakiness.ts`
- **API Contract** — `contracts/player-api.ts` + `tests/contract/player-api.spec.ts`. Corre primero en CI.

## Skills disponibles

- `qa-knowledge-writer` — genera/actualiza los 9 archivos canónicos de un módulo (código + internet)
- `/session-review` — protocolo de cierre de sesión
