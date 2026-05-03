# AI Test Generation Contract

Dos modos de generación. Cada modo tiene su propio contrato.

---

## Modo Feature (invocado desde /doc-feature)

Requiere brief completo. Sin brief completo → **no generar**.

### Campos obligatorios del brief

- `feature`
- `scope`
- `goal`
- `preconditions`
- `input_expected`
- `output_expected`
- `assertion_rationale`
- `observability.primary`
- `false_positive_risks`
- `test_type`
- `determinism_level`

### Reglas

1. Sin `feature-spec` → no generar.
2. Sin `business-rules` → no generar.
3. Sin `observability` → no generar.
4. Sin señal primaria definida → no generar.
5. Sin justificación de aserción → no generar.
6. Señal inestable sin mitigación → marcar para revisión humana.

---

## Modo Regresión (invocado desde /review-diff)

Genera desde contexto del diff. Brief completo no requerido.

### Campos requeridos (provistos por el pipeline, no por el brief)

- Módulo afectado — del `risk-map.json`
- Comportamiento que cambió — del diff
- Tipo de test apropiado — del `coverage-report.json`

### Reglas

1. Solo generar para gaps con `priority: "MUST"` en `coverage-report.json`.
2. Cada test generado lleva tag `@regression`.
3. Cada spec generado lleva comentario de apertura: `// Draft: generado por pipeline — revisar antes de merge`.
4. Sin contexto de diff suficiente → no generar, reportar al usuario.

---

## Regla de salida (ambos modos)

Todo spec generado por IA debe incluir un bloque de cabecera con:
- input esperado
- output esperado
- justificación de la aserción
- señales primarias
- riesgos de falso positivo
