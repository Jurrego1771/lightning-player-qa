# MEMORY INDEX — Lightning Player QA

Índice del sistema de memoria persistente para sesiones de Claude Code.
Cada línea apunta a un archivo de memoria específico.
Máximo 200 líneas — mantener conciso.

---

## Proyecto

- [Contexto del Proyecto](project_context.md) — Qué es este proyecto, scope, objetivos, ambientes
- [Filosofía de Testing](testing_philosophy.md) — Principios, pirámide, qué NO hacer

## Sistema Bajo Test — Lightning Player

- [Sistema del Player — API pública](player_system.md) — **LEER PRIMERO.** API real verificada desde código fuente v1.0.58: init, métodos, propiedades, eventos, ad systems, DRM. Incluye correcciones a supuestos incorrectos previos.
- [Arquitectura Interna](player_architecture.md) — React+Jotai, hls.js internals, sistema de eventos, flujo de IMA, SGAI, por qué los asserts deben ser poll-based

## Decisiones Técnicas

- [Decisiones Registradas](decisions.md) — Por qué elegimos X sobre Y, trade-offs aceptados

## Gaps y Correcciones Pendientes

- [Testing Gaps](testing_gaps.md) — **LEER ANTES DE ESCRIBIR TESTS.** Gaps sin cobertura, correcciones urgentes, supuestos incorrectos identificados desde el código fuente del player.

## Aprendizajes de Sesiones

- [2026-04-08 Análisis del repo del player](sessions/2026-04-08_player-repo-analysis.md) — Primera inspección del código fuente del player. Hallazgos críticos: DASH sin dash.js, SGAI con bugs, multi-instancia, `ads.map` vs `adsMap`.

---

## Variables de entorno críticas

- `PLATFORM_API_TOKEN` — token hex del API admin de Mediastream. Sin él, tests de live se saltean. Obtener en dev.platform.mediastre.am → Settings → API & Tokens. NO expira.
- `PLATFORM_API_URL` — default `https://dev.platform.mediastre.am/api`. El access token de playback (single-use, 30 min) se genera por test via `helpers/access-token.ts`.

## Sistemas de Automatización Implementados

- **Performance trend tracking** — `helpers/perf-storage.ts` + `scripts/compare-perf.ts` + `performance-baseline/metrics.json`. Detecta regresiones >20% entre runs.
- **Flaky test detection** — `reporters/flakiness-reporter.ts` + `scripts/analyze-flakiness.ts` + `flaky-results/quarantine.json`. Tests con score >30% en ≥3 runs se cuarentenan con `test.fixme()` automático.
- **API Contract** — `contracts/player-api.ts` (fuente de verdad) + `tests/contract/player-api.spec.ts`. Corre primero en CI. Falla con "CONTRACT VIOLATION" explícito si el player rompe métodos/propiedades/eventos.

## Skills disponibles

- `/sync-knowledge` — Lee el player repo y detecta diffs vs esta memoria. Correr cuando el player hace release.
- `/session-review` — Protocolo de cierre de sesión. Guarda learnings en los archivos correctos.

---

## Notas de uso

- `player_system.md` es la fuente de verdad de la API del player. Si hay conflicto con `CLAUDE.md`, confiar en `player_system.md` (fue verificada desde el código fuente).
- `testing_gaps.md` tiene el estado (⬜/✅) de cada gap. Actualizar cuando se implementen tests.
- Para el skill `/sync-knowledge`, el player repo viene de `$PLAYER_LOCAL_REPO` en `.env` (varía por máquina).
