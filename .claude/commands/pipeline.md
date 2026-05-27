# /pipeline — Orquestador QA completo

Pipeline QA del Lightning Player. Orquesta los agentes A1–A11 en el flujo correcto.

## Modos de invocación

```
/pipeline [ref]                    → pipeline completo (A1→A11)
/pipeline [ref] --dry-run          → solo A1+A2: muestra risk assessment y STOP
/pipeline [ref] --plan             → A1→A4: análisis + coverage + plan, STOP antes de ejecutar
/pipeline [ref] --run              → A1→A10: análisis + tests + flaky filter + veredicto
/pipeline [ref] --run --report     → A1→A10 + comentario en PR y Slack
/pipeline --from-plan              → salta A1-A4, ejecuta test_plan existente en session_state.json
/pipeline --calibrate [módulo]     → solo A11 en el módulo dado (o todos si se omite)
/pipeline --capture-baselines      → solo A9 en modo --update-baselines
```

`[ref]` puede ser: número de PR (`42`), nombre de rama (`feature/sgai-buffering`), commit hash (`abc1234`), o vacío (último commit en main).

---

## PASO 0 — Prerequisitos

```bash
cat .env 2>/dev/null | grep "PLAYER_GITHUB_REPO"
gh auth status 2>/dev/null
```

Si `PLAYER_GITHUB_REPO` no está → **STOP**: pedir al usuario que lo configure en `.env`.

Inicializar `state/session_state.json` con el run actual:
```json
{ "pipeline_run": "[timestamp]", "ref": "[ref]", "created_at": "[ISO8601]" }
```

---

## FASE ANÁLISIS — A1 → A2

### [A1] diff-analyzer

Invocar agente `diff-analyzer`:

> "Obtén el diff de [ref]. Clasifica cada archivo modificado en su módulo del player. Detecta cross_cutting_risk si constants.cjs o src/api/api.js están en el diff. Escribe el campo `diff` en state/session_state.json."

```
[A1] diff-analyzer...       ✅ [N] archivos · módulos: [lista]
```

Si diff vacío → **STOP**.

### [A2] risk-mapper

Invocar agente `risk-mapper`:

> "Lee state/session_state.json (campo diff). Cruza con risk_map.yaml. Calcula risk_score por módulo afectado. Consulta issues de GitHub si risk_label global es CRITICAL o HIGH. Escribe campo `risk_assessment` en state/session_state.json."

```
[A2] risk-mapper...         ✅ [risk_label_global] · [N] módulos afectados
```

### Mostrar resumen + STOP si `--dry-run`

```
═══════════════════════════════════════════════════════════
  RISK ASSESSMENT — [ref]
═══════════════════════════════════════════════════════════
  Riesgo global: [CRITICAL|HIGH|MEDIUM|LOW]
  Módulos: [lista con scores]

  [rationale del risk-mapper]

  Issues relacionados: #N, #M (si los hay)
═══════════════════════════════════════════════════════════
```

Si `--dry-run` → **STOP**.

---

## FASE PLANIFICACIÓN — A4 → [A5] → A3

### [A4] coverage-auditor

Invocar agente `coverage-auditor`:

> "Lee state/session_state.json (diff + risk_assessment). Para módulos CRITICAL y HIGH, audita qué tests cubren los archivos modificados. Identifica gaps MUST y SHOULD. Escribe campo `coverage_gaps` en state/session_state.json."

```
[A4] coverage-auditor...    ✅ [N] gaps MUST · [M] gaps SHOULD
```

### [A5] test-generator (condicional — solo si hay gaps MUST)

Si `coverage_gaps` tiene items con `priority: "MUST"`:

```
⚠️  [N] gaps MUST detectados. ¿Generar nuevos specs? [s/N]
```

Si confirma → invocar `test-generator`:

> "Lee state/session_state.json (coverage_gaps). Genera specs de Playwright para los gaps con priority MUST. Importa desde fixtures/, usa waitForEvent(), lee context/features/[feature].md para el contrato. Usa skills/write_test_file.ts para escribir."

```
[A5] test-generator...      ✅ [N] specs generados
```

### [A3] test-selector

Invocar agente `test-selector`:

> "Lee state/session_state.json (risk_assessment + coverage_gaps). Elige la batería mínima: CRITICAL→contract+e2e+integration+smoke; HIGH→integration+e2e selectivo; MEDIUM→integration; LOW→smoke. Añadir visual si hay módulos UI. Escribe campo `test_plan` en state/session_state.json."

```
[A3] test-selector...       ✅ [N] pasos · ~[M] min estimado
```

### Mostrar plan + STOP si `--plan`

```
═══════════════════════════════════════════════════════════
  TEST PLAN — [ref]
═══════════════════════════════════════════════════════════
  Paso 1: [comando] (~[tiempo])
  Paso 2: [comando] (~[tiempo])
  ...
  Total estimado: ~[N] min  (suite completa: ~[M] min · ahorro: [K]%)
═══════════════════════════════════════════════════════════
```

Si `--plan` → **STOP**.

Sino (modo interactivo): `¿Ejecutar la batería? [s/N]`

---

## FASE EJECUCIÓN — A6 + A9 (paralelo)

### [A6] Test Runner (ejecución directa de Playwright)

Para cada paso en `session_state.json.test_plan`:

```bash
[comando del paso]
```

Mostrar progreso en tiempo real:
```
[A6] contract...            ✅ 9/9 (28s)
[A6] integration/ads...     ❌ 2 fallos (45s)
[A6] e2e...                 ✅ 14/14 (2m 3s)
```

### [A9] visual-regression (paralelo con A6)

Si el test plan incluye módulos UI (`ui-video`, `ui-radio`, `ui-compact`), lanzar en background mientras corre A6:

> "Captura los 7 estados del player y compara contra baselines/. Escribe campo `visual_results` en state/session_state.json."

```
[A9] visual-regression...   ✅ 7/7 estados · [N] diffs visuales
```

Los fallos visuales **no son bloqueantes** — se incluyen en el resumen para revisión humana.

---

## FASE FILTRADO — A10

### [A10] flaky-detector

Si hay tests fallidos, invocar `flaky-detector`:

> "Para cada test fallido: consulta skills/get_flaky_history.ts. Si flaky_count_30d >= 2, re-ejecuta hasta 3 veces. Separa confirmed_failures y flaky_filtered. Actualiza state/flaky_registry.json. Escribe campo `flaky_filtered` en state/session_state.json."

```
[A10] flaky-detector...     ✅ [C] confirmados · [F] flaky filtrados
```

Si 0 fallos confirmados → **PR aprobado**. Saltar a resumen final.

---

## FASE ANÁLISIS DE FALLOS — A7 → A8

### [A7] results-analyzer

Invocar `results-analyzer`:

> "Lee playwright-report/report.json y state/session_state.json. Analiza solo los confirmed_failures (ya filtrados por A10). Determina root cause por fallo. Emite veredicto: SAFE_TO_MERGE | INVESTIGATE | DO_NOT_MERGE. Escribe campos `verdict` y `failure_analysis` en state/session_state.json."

```
[A7] results-analyzer...    ✅ VEREDICTO: [SAFE_TO_MERGE|INVESTIGATE|DO_NOT_MERGE]
```

### [A8] issue-reporter (solo si DO_NOT_MERGE)

Si `verdict === DO_NOT_MERGE`:

> "Lee state/session_state.json (verdict + failure_analysis). Para cada fallo PLAYER_REGRESSION crea un GitHub issue via skills/create_gh_issue.ts. Comenta el PR con tabla de módulos afectados y links a los issues via skills/comment_pr.ts. Si SLACK_WEBHOOK configurado, notifica via skills/notify_slack.ts."

```
[A8] issue-reporter...      ✅ [N] issues creados · PR comentado
```

---

## RESUMEN FINAL

```
═══════════════════════════════════════════════════════════
  PIPELINE — [ref]
═══════════════════════════════════════════════════════════

  [A1] diff-analyzer         ✅ [N] archivos · módulos: [lista]
  [A2] risk-mapper           ✅ [risk_label] · [N] módulos
  [A4] coverage-auditor      ✅ [N] gaps MUST · [M] SHOULD
  [A3] test-selector         ✅ [N] pasos
  [A6] test runner           ✅/❌ [passed]/[total] · [tiempo]
  [A9] visual-regression     ✅ [N] estados · [M] diffs
  [A10] flaky-detector       ✅ [C] confirmados · [F] flaky
  [A7] results-analyzer      ✅ veredicto emitido
  [A8] issue-reporter        ✅ [N] issues · PR comentado   (si aplica)

  VEREDICTO: ✅ SAFE_TO_MERGE | ⚠️ INVESTIGATE | ❌ DO_NOT_MERGE

═══════════════════════════════════════════════════════════
```

---

## POST-MERGE — A11 (Risk Calibrator)

Al mergear a main, recalibrar el mapa de riesgos:

```
/pipeline --calibrate
```

Invoca `risk-calibrator` (A11) que recalcula `risk_map.yaml` con señales reales: frecuencia de commits 90d, bugs cerrados, tamaño del módulo, ratio de cobertura y failure rate de CI.

---

## REGLAS

1. Siempre inicializar `session_state.json` antes de A1.
2. Si A1 no encuentra diff → STOP inmediato.
3. Si A2 falla → continuar asumiendo riesgo HIGH (fail-safe).
4. A9 corre en paralelo con A6 — no bloquea el test runner.
5. A10 siempre filtra antes de A7 — A7 nunca ve flaky sin confirmar.
6. A8 solo actúa cuando `verdict === DO_NOT_MERGE`.
7. A11 solo corre al mergear a main, nunca durante análisis de PR.
8. `--from-plan` requiere `test_plan` válido en session_state.json.
