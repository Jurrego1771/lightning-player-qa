# CLAUDE.md — Lightning Player QA

## Identidad

| Campo | Valor |
|---|---|
| **Proyecto** | `lightning-player-qa` — suite QA independiente para Mediastream Lightning Player |
| **Stack** | Playwright · TypeScript · axe-core · Express (mock VAST) |
| **Repo QA** | `D:\Dev\Repos\jurrego1771\lightning-player-qa` |
| **Repo Player (SUT)** | `$PLAYER_LOCAL_REPO` (configurar en `.env`) |
| **Player version** | `1.0.75` · branch `develop` |

## Reglas duras

- Solo API pública del player. Nunca internals ni clases CSS internas.
- Importar siempre desde `fixtures/` — nunca de `@playwright/test` directamente.
- `player_system.md` tiene precedencia sobre este archivo en caso de conflicto.

## Conocimiento del proyecto

La fuente de verdad vive en `qa-knowledge/` y `.claude/memory/`. Leer antes de trabajar:

- [`qa-knowledge/modules/`](qa-knowledge/modules/) — conocimiento por módulo: overview, acceptance, risks, defects, learnings, dependencies, tests, business-rules, user-stories
- [`risk_map.yaml`](risk_map.yaml) — mapa de riesgo dinámico por módulo (calibrado por A11)
- [`docs/core.md`](docs/core.md) — filosofía QA, reglas de aserción, anti-patrones, glosario
- [`.claude/memory/player_system.md`](.claude/memory/player_system.md) — API pública verificada desde código fuente
- [`.claude/memory/testing_gaps.md`](.claude/memory/testing_gaps.md) — leer antes de escribir tests
- [`.claude/memory/MEMORY.md`](.claude/memory/MEMORY.md) — índice de memoria persistente

## Estructura del proyecto

```
lightning-player-qa/
├── qa-knowledge/           ← fuente de verdad del player para agentes
│   ├── modules/            ← un directorio por módulo del player
│   │   └── {module}/
│   │       ├── overview.md
│   │       ├── acceptance.yaml
│   │       ├── dependencies.yaml
│   │       ├── risks.yaml
│   │       ├── learnings.yaml
│   │       ├── defects.yaml
│   │       ├── tests.yaml
│   │       ├── business-rules.md
│   │       └── user-stories.md
│   └── schemas/            ← esquemas YAML de referencia
├── risk_map.yaml           ← mapa de riesgo dinámico (actualizado por A11 post-merge)
├── state/                  ← estado del pipeline en curso
│   ├── session_state.json  ← diff → risk → plan → results → verdict
│   └── flaky_registry.json ← historial de tests inestables (últimos 30d)
├── baselines/              ← imágenes de referencia visual para A9
├── fixtures/               ← index.ts · player.ts · streams.ts · platform-mock.ts
├── tests/
│   ├── contract/           ← API contract (corre primero en CI)
│   ├── e2e/                ← flujos completos de usuario
│   ├── integration/        ← HLS/DASH + mock streams + ad beacons
│   ├── visual/             ← screenshot regression
│   ├── a11y/               ← axe-core WCAG 2.1 AA
│   └── performance/        ← QoE metrics con CDP
├── skills/                 ← scripts TypeScript ejecutables (funciones sin LLM)
│   ├── get_pr_diff.ts · load_risk_map.ts · search_tests.ts
│   ├── write_test_file.ts · visual_diff.ts · capture_state.ts · get_flaky_history.ts
│   ├── retry_test.ts · get_commit_frequency.ts · get_issue_history.ts · get_module_size.ts
│   ├── update_risk_map.ts · create_gh_issue.ts · comment_pr.ts · notify_slack.ts
├── scripts/
│   ├── analyze-diff.ts     ← script legacy compatible (usa risk_map.yaml)
│   └── extract-stats.js    ← stats post-run
├── mock-vast/              ← servidor Express VAST
├── helpers/                ← qoe-metrics.ts · network-conditions.ts
└── .claude/
    ├── commands/           ← /pipeline · /session-review · /write-test
    ├── agents/             ← A1–A11: diff-analyzer · risk-mapper · test-selector · coverage-auditor
    │                          test-generator · results-analyzer · issue-reporter · visual-regression
    │                          flaky-detector · risk-calibrator
    └── memory/             ← memoria persistente entre sesiones
```

## Agentes del pipeline (A1–A11)

| ID | Agente | Función |
|----|--------|---------|
| A1 | `diff-analyzer` | Obtiene diff, clasifica archivos por módulo |
| A2 | `risk-mapper` | Cruza diff con risk_map.yaml → risk score |
| A3 | `test-selector` | Elige batería mínima de tests |
| A4 | `coverage-auditor` | Detecta gaps MUST/SHOULD de cobertura |
| A5 | `test-generator` | Genera specs para gaps MUST |
| A6 | *(ejecución directa)* | Playwright test runner |
| A7 | `results-analyzer` | Root cause + veredicto SAFE/INVESTIGATE/DO_NOT_MERGE |
| A8 | `issue-reporter` | Crea GitHub issues + comenta PR (solo si DO_NOT_MERGE) |
| A9 | `visual-regression` | Screenshots vs baselines (paralelo con A6) |
| A10 | `flaky-detector` | Filtra fallos flaky antes de A7 |
| A11 | `risk-calibrator` | Recalibra risk_map.yaml post-merge |

## Comandos clave

```bash
npm run test:ci                         # todos los tests Tier 1
npm run test:e2e / :integration / :a11y / :visual / :performance
npx playwright test tests/e2e/vod-playback.spec.ts   # spec específico
npx playwright test --ui                # modo visual / debug
/pipeline [PR|branch|commit]            # pipeline QA completo
/pipeline [ref] --dry-run               # solo análisis de riesgo
/pipeline [ref] --plan                  # análisis + plan de tests
/pipeline --calibrate                   # recalibrar risk_map.yaml (post-merge)
/pipeline --capture-baselines           # capturar nuevas imágenes baseline
npm run report                          # abrir reporte HTML del último run
npm run mock-vast:start                 # servidor VAST para tests de ads
npx ts-node skills/[nombre].ts [args]   # ejecutar skill directamente
```

## Scope

**No está en scope aquí:**
- Unit tests → van en el repo del player (Vitest)
- Tests del backend/plataforma → otro repo

**SGAI (Google Server-Guided Ad Insertion):** gap conocido — `tests/integration/sgai.spec.ts` no existe.
`useGoogleSGAILifecycle.js` tiene casos edge en estado `buffering` + interacción SGAI+DVR sin testear.
