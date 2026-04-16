# Observability Model

## Jerarquía de señales

1. Eventos públicos documentados
2. Retornos de API pública
3. Estado visible en UI accesible
4. Propiedades públicas estables
5. DOM interno o timing implícito

Mientras más abajo esté la señal, mayor el riesgo de falsos positivos.

## Regla general

- No usar una propiedad pública como señal primaria si el repo ya documenta que es eventual, vacía o no sincronizada.
- Preferir eventos como contrato observable cuando representan mejor la transición.

## Ejemplo real del repo

- `player.metadata` ya está documentado como señal no confiable inmediata en `docs/api-coverage.md`.
- Para cambios de contenido, `metadataloaded` es una señal primaria más fuerte que leer `player.metadata` justo después de `load()`.
