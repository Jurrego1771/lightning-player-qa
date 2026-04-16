# Testing Philosophy

## Principios

- Determinismo sobre volumen.
- Una aserción fuerte vale más que tres aserciones decorativas.
- No asumir funcionamiento del feature: documentarlo antes.
- No usar señales débiles como si fueran contrato.
- Toda prueba debe poder explicar por qué esa aserción representa el comportamiento esperado.

## Regla de diseño

Cada test nuevo debe responder explícitamente:
- Qué input controlé
- Qué output espero
- Qué señal observo
- Por qué esa señal es válida
- Qué podría hacer que este test falle o pase por la razón incorrecta
