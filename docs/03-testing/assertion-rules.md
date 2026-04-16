# Assertion Rules

## Obligatorio en todo test nuevo

- `Input esperado`
- `Output esperado`
- `Justificación de la aserción`

## También recomendado

- `Señales primarias`
- `Señales secundarias`
- `Riesgos de falso positivo`

## Reglas

- No usar `waitForTimeout()` salvo que el tiempo sea parte del comportamiento validado.
- No validar solo que una función fue llamada si el comportamiento real es una transición de estado.
- No usar una señal eventual como aserción inmediata sin `expect.poll()`.
- Si una aserción se apoya en comportamiento observado y no estrictamente documentado, decirlo.
