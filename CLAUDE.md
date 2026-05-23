# CLAUDE.md — Lightning Player QA

## Identidad

| Campo | Valor |
|---|---|
| **Proyecto** | `lightning-player-qa` — suite QA independiente para Mediastream Lightning Player |
| **Stack** | Playwright · TypeScript · axe-core · Express (mock VAST) |
| **Repo QA** | `D:\Dev\Repos\jurrego1771\lightning-player-qa` |
| **Repo Player (SUT)** | `$PLAYER_LOCAL_REPO` (configurar en `.env`) |
| **Player version** | `1.0.62` · branch `develop` |

## Reglas duras

- No generar tests sin documentación de la feature en `docs/02-features/{feature}.md`.
- Solo API pública del player. Nunca internals ni clases CSS internas.
- Importar siempre desde `fixtures/` — nunca de `@playwright/test` directamente.
- `player_system.md` tiene precedencia sobre este archivo en caso de conflicto.

## Conocimiento del proyecto

La fuente de verdad vive en `docs/` y `.claude/memory/`. Leer antes de trabajar:

- [`docs/core.md`](docs/core.md) — filosofía, reglas de aserción, anti-patrones, glosario
- [`docs/02-features/00-index.md`](docs/02-features/00-index.md) — inventario de features y API del player
- [`docs/02-features/{feature}.md`](docs/02-features/) — activación, observabilidad, BRs, edge cases por feature
- [`.claude/memory/player_system.md`](.claude/memory/player_system.md) — API pública verificada
- [`.claude/memory/testing_gaps.md`](.claude/memory/testing_gaps.md) — leer antes de escribir tests
- [`.claude/memory/MEMORY.md`](.claude/memory/MEMORY.md) — índice de memoria persistente

## Estructura del proyecto

```
lightning-player-qa/
├── fixtures/           ← index.ts · player.ts · streams.ts · platform-mock.ts
├── tests/
│   ├── contract/       ← API contract (corre primero en CI)
│   ├── e2e/            ← flujos completos de usuario
│   ├── integration/    ← HLS/DASH + mock streams + ad beacons
│   ├── visual/         ← screenshot regression
│   ├── a11y/           ← axe-core WCAG 2.1 AA
│   └── performance/    ← QoE metrics con CDP
├── scripts/
│   ├── analyze-diff.ts ← reemplaza prepare-diff.sh + agentes diff-analyzer + coverage-checker
│   └── extract-stats.js← stats post-run sin agente
├── mock-vast/          ← servidor Express VAST
├── helpers/            ← qoe-metrics.ts · network-conditions.ts
├── .claude/
│   ├── commands/       ← skills (/review-diff, /session-review, etc.)
│   ├── agents/         ← definiciones de agentes especializados
│   └── memory/         ← memoria persistente entre sesiones
└── docs/               ← fuente de verdad versionada
```

## Comandos clave

```bash
npm run test:ci                        # todos los tests Tier 1
npm run test:e2e / :integration / :a11y / :visual / :performance
npx playwright test tests/e2e/vod-playback.spec.ts  # spec específico
npx playwright test --ui               # modo visual / debug
npm run diff:analyze [PR|branch|commit] # análisis de cambios + coverage
npm run report                         # abrir reporte HTML del último run
npm run fixtures:generate              # genera HLS fixtures locales (requiere ffmpeg)
npm run mock-vast:start                # servidor VAST para tests de ads
```

## Scope

**No está en scope aquí:**
- Unit tests → van en el repo del player (Vitest)
- Tests del backend/plataforma → otro repo

**SGAI (Google Server-Guided Ad Insertion):** gap conocido — `tests/integration/sgai.spec.ts` no existe.
`useGoogleSGAILifecycle.js` tiene casos edge en estado `buffering` + interacción SGAI+DVR sin testear.
