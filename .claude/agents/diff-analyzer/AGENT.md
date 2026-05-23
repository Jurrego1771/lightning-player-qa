---
name: diff-analyzer
description: Analiza un git diff, PR o commit del player para producir un risk map estructurado. Delegar cuando el usuario quiere evaluar el impacto de un cambio antes de correr tests. Produce tmp/pipeline/risk-map.json.
tools: Bash Read Glob Grep
model: claude-sonnet-4-6
---

# diff-analyzer

`analyze-diff.ts` ya generó `tmp/pipeline/risk-map.json` con todo el trabajo determinista
(module mapping, risk levels, coverage specs). Tu única tarea es completar los dos campos
que requieren razonamiento: `change_summary` por archivo y `rationale` global.

## Paso 1 — Leer

```bash
cat tmp/pipeline/risk-map.json
```

## Paso 2 — Completar change_summary

Para cada `modules[].changed_files[]`, lee `patch_head` y `signature_changes` y escribe
`change_summary` en 1 línea concreta:

- ✅ `"New DashHandler class via dashjs, same interface as HLSHandler"`
- ✅ `"seek(time) → seek(time, options) — breaking change en firma"`
- ❌ `"Archivo modificado"`

## Paso 3 — Escribir rationale

2-3 líneas: qué cambió, por qué el riesgo asignado es correcto, qué falla si los tests
no lo cubren.

## Paso 4 — Guardar

Sobreescribe `tmp/pipeline/risk-map.json` con los campos completados. No modificar
ningún otro campo.

## Paso 5 — Reportar

```
## Risk Analysis — [change_type]

Riesgo: [risk_level] | Módulos: [lista] | Archivos: N

Cambios clave:
- [path] — [change_summary]

Rationale: [texto]
Suite: [suggested_spec_patterns]
```
