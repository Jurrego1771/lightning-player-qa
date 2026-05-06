---
name: review-diff
description: Pipeline de revisión de cambios. Analiza un diff/PR/commit, evalúa riesgos, verifica cobertura y ejecuta la suite óptima. Dos fases: análisis por defecto, ejecución con --run.
---

# /review-diff — Pipeline de Revisión de Cambios

Orquestador del pipeline de QA para `lightning-player-qa`.
Coordina agentes especializados. Cada agente es responsable de lo que necesita — no pre-cheques en nombre de ellos.

## Invocación

```
/review-diff 42                  → analiza PR #42 del player
/review-diff feature/pip-mode    → analiza rama vs main
/review-diff abc1234             → analiza commit específico
/review-diff                     → analiza último commit en main
/review-diff --qa                → analiza cambios en este repo QA
/review-diff --dry-run           → análisis sin ejecutar tests
/review-diff 42 --run            → análisis + ejecución completa
```

Fuente de datos: GitHub API (preferida). Requiere `PLAYER_GITHUB_REPO` en `.env`.
Fallback a repo local si GitHub no disponible.

---

## FASE 1 — Análisis (siempre corre)

### Paso 0 — Preparar entorno

```bash
mkdir -p tmp/pipeline
```

Confirmar al usuario:
```
🚀 /review-diff — [input o "último commit"] · modo: [análisis | análisis+ejecución | dry-run]
```

### Paso 0.5 — Pre-procesar diff

```bash
bash scripts/prepare-diff.sh [input]
```

- `--qa` → saltar este paso
- Si el script falla → pedir al usuario que pegue el diff directamente y continuar

Si termina bien:
```
✅ Diff pre-procesado: N archivos · Módulos: [lista]
```

### Paso 1 — Análisis de riesgo

Delega a `diff-analyzer`:

> Lee `tmp/pipeline/diff-input.json` y produce `tmp/pipeline/risk-map.json`.
> Si necesita contexto adicional (docs, código fuente), búscalo tú mismo.

Muestra el risk map al usuario.

Si `risk_level = LOW` y `change_type = docs` → informar y preguntar si continuar.

### Paso 2 — Verificación de cobertura

Delega a `coverage-checker`:

> Lee `tmp/pipeline/risk-map.json` y evalúa cobertura en `tests/`.
> Produce `tmp/pipeline/coverage-report.json`.
> Incluir campo `should_generate_tests: boolean` en el output.

Muestra el coverage report al usuario.

---

**— Fin Fase 1 —**

Si NO se pasó `--run` ni `--dry-run`, preguntar:

```
📋 Análisis completado.
   Gaps MUST: N  |  Tests existentes relevantes: N
   
   ¿Qué hacemos?
   [S] Ejecutar suite óptima
   [n] Terminar aquí
   [m] Modificar plan antes de ejecutar
```

- `n` → entregar resumen y terminar
- `S` o `m` → continuar a Fase 2

---

## FASE 2 — Ejecución (solo con --run o aprobación del usuario)

### Paso 3 — Generación de tests (condicional)

**Solo si `coverage-report.json` tiene `should_generate_tests: true`.**

Delega a `test-generator`:

> Lee `tmp/pipeline/coverage-report.json` y `tmp/pipeline/risk-map.json`.
> Genera specs para gaps con priority MUST.
> Si necesitas docs de features, búscalos en `docs/02-features/`. Si no existen, genera en modo básico e indica qué faltó en tu output.

Muestra archivos generados. Preguntar:

```
📝 N specs generados. ¿Incluirlos en la suite? [S/n]
```

### Paso 4 — Selección de suite

Delega a `test-selector`:

> Lee `tmp/pipeline/risk-map.json` y `tmp/pipeline/coverage-report.json`.
> Produce `tmp/pipeline/test-plan.json` con comandos exactos.
> Incluir campo `auto_keep_pipeline: boolean` (true si hay steps bloqueantes o riesgo HIGH).

Si el usuario eligió `[m]odificar` → mostrar el plan y preguntar qué agregar/quitar antes de ejecutar.

### Paso 5 — Ejecución

Ejecutar los comandos de `test-plan.json` en orden. Mostrar progreso:

```
▶ Paso N/N: [label]
```

Si un paso con `blocking: true` falla:
```
⛔ Paso [N] falló (bloqueante). Pasos siguientes cancelados.
   [error resumido]
   ¿Continuar de todas formas? [s/N]
```

Pasos no bloqueantes: continuar aunque fallen, registrar en el resumen.

### Paso 6 — Análisis de resultados

Delega a `results-analyzer`:

> Lee `tmp/pipeline/risk-map.json`, `tmp/pipeline/coverage-report.json`,
> `tmp/pipeline/test-plan.json` y `playwright-report/report.json`.
> Produce `tmp/pipeline/results-report.json` y presenta el informe ejecutivo.

### Paso 7 — Limpieza

Auto-decisión basada en resultados:
- Hubo fallos → mover a `pipeline-history/YYYY-MM-DD_HH-MM_<change-type>/`
- Todo pasó → `rm -rf tmp/pipeline/`

Resumen final:

```
✅ Pipeline completado

Veredicto: SAFE TO MERGE | INVESTIGATE | DO NOT MERGE
Tests: N ejecutados · N passed · N failed
Tests generados: N specs nuevos
Tiempo: X min
```

---

## Modo --dry-run

Ejecutar Pasos 1 y 2. Mostrar risk map + coverage report + test plan propuesto sin ejecutar nada.

---

## Manejo de errores

Si cualquier agente falla o produce output inválido:
1. Mostrar el error
2. Preguntar si continuar con el siguiente paso o detenerse
3. Nunca inventar resultados de agentes
