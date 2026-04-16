# AI Test Generation Contract

No se debe generar un test nuevo si no existe un `test brief` completo.

## Campos obligatorios

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

## Reglas de pipeline

1. Si falta `feature-spec`, no generar.
2. Si falta `business-rules`, no generar.
3. Si falta `observability`, no generar.
4. Si el brief no define señal primaria, no generar.
5. Si el brief no explica por qué la aserción es válida, no generar.
6. Si el brief usa una señal catalogada como inestable sin mitigación, marcar para revisión humana.

## Regla de salida

Todo spec generado por IA debe incluir un bloque inicial con:
- input esperado
- output esperado
- justificación de la aserción
- señales primarias
- riesgos de falso positivo
