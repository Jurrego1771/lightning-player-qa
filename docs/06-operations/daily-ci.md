# Daily QA en GitHub Actions (`dev-daily.yml`)

Suite QA automatizada contra `develop` del player. Filosofía: **a diario corre solo
lo crítico y rápido ("lo que no puede fallar"); lo amplio/lento corre semanal o en PR.**

## Cuándo corre y qué ejecuta

| Trigger | Jobs | Bloqueante |
|---|---|---|
| **push → main** | contract + smoke | sí |
| **PR → main** | contract + smoke + integration completo | sí |
| **schedule Mar–Vie 7 AM** (`0 12 * * 2-5`) | contract + smoke + integration `@critical` | contract/smoke sí · `@critical` **no** |
| **schedule Lunes 7 AM** (`0 12 * * 1`) | + e2e cross-browser + integration completo + a11y + visual + perf | sí |
| **workflow_dispatch** | según input `suite` (full / e2e-only / smoke-only) + `@critical` | sí |

El split ligero/completo se decide con `github.event.schedule` (el cron exacto).

## El gate diario (Mar–Vie)

- **Bloqueante** (si falla → daily rojo, accionable): **contract** (API shape) + **smoke** (init/play/pause). Deterministas, ~10 min con cache.
- **Informativo** (`continue-on-error: true`): **integration `@critical`** (`--workers=1`). Hoy estos tests de media (DASH/HLS/sourcechange/playback) son **flaky** (timing) — se reportan en Slack pero **no marcan el daily en rojo**. Confirmado flaky en CI limpio, no solo local.

## Disparar bajo demanda

```bash
gh workflow run dev-daily.yml -f suite=smoke-only   # réplica del daily ligero (contract+smoke+@critical)
gh workflow run dev-daily.yml -f suite=full         # suite completa (cross-browser, integration, a11y, visual, perf)
```

## Cómo iterar el alcance (agregar/quitar tests del gate)

Dos tags controlan qué entra/sale, **sin tocar el workflow** — solo el `tag:` del `test.describe`:

| Tag | Efecto | Dónde |
|---|---|---|
| **`@critical`** | Entra al gate diario (job integration-critical, `--grep "@critical"`) | `test.describe('...', { tag: ['@critical', ...] }, ...)` |
| **`@flaky`** | Sale del proyecto `chromium` (gate) — `grepInvert: /@flaky/` en `playwright.config.ts` | ídem |

- ¿Un test debe vigilarse a diario? → agrégale `@critical`.
- ¿Un test es no-determinista y ensucia el gate? → agrégale `@flaky` (sale del daily; sigue corriendo en runs manuales si lo invocas directo).
- Para hacer `@critical` **bloqueante** (cuando se estabilice): quitar `continue-on-error: true` del job `integration-critical`.

### Set actual
- **`@critical`** (~65 tests): core `playback-core-edge`, `hls-abr`, `dash-handler-select`, `player-init-methods`, `controls-api-edge`, `sourcechange`, `error-recovery` + ads `ads-ima-skip`/`volume-sync`/`seek-prevention`.
- **`@flaky`** (excluidos): `ads-ima-error:233` (race autoplay), `ads-ima-tag-params` (pubads real, no-fill), `pause-ad-flow`.

## Notificaciones Slack

El job `notify-results` envía al canal de pruebas usando el secret
`SLACK_TEST_BATTERY_WEBHOOK_URL` (GitHub → Settings → Secrets → Actions). Notifica en
schedule y en workflow_dispatch. Muestra estado por job (Contract, Smoke, Integration
@critical, etc.). El daily sale verde aunque `@critical` falle (es informativo).

## Fuentes de ads en los tests (CSAI)

- **Playback** (skip/seek/volume/locale): VAST real estático de basil79
  (`fixtures/ima-sample-tags.ts` → `StaticVastTags`) — determinista, sin mock.
- **VMAP / error / macros / verificación de beacons**: mock local (`mock-vast/`) —
  basil no cubre esos casos; los VMAP de pubads real no se insertan por `adsMap` en el harness.
- **NonLinear**: usar tag oficial IMA **sin `impl=s`** (`ImaSampleTags.singleNonLinearInline`).
  Tags con `impl=s` NO reproducen (request 200 pero el ad no arranca).

## Pendientes conocidos

1. **`@critical` flaky**: estabilizar los tests de media (poll del handler/estado en
   vez de assert directo) antes de hacerlos bloqueantes.
2. **Setup lento** (`apt-get` de Playwright deps): parcheado con timeouts (contract 15,
   smoke 20 min). Fix de fondo: container `mcr.microsoft.com/playwright` (trae deps
   preinstaladas; requiere resolver ffmpeg para los fixtures HLS aparte).
