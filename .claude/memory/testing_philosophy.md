---
name: Filosofía de Testing
description: Principios fundamentales, pirámide, qué NO hacer, estrategia de datos de test
type: project
---

# Filosofía de Testing — Lightning Player QA

## Los 5 Principios

1. **No mockear el browser** — los players dependen de `MediaSource`, `HTMLVideoElement`, `EME`.
   Tests útiles corren en browsers reales (Playwright, no jsdom para E2E).

2. **Determinismo sobre cobertura** — mejor 50 tests que siempre pasan que 200 intermitentes.
   Los streams live son no-deterministas; usar Chaos Proxy o streams de test estables.

3. **Observar desde afuera** — la automatización usa solo la API pública del player.
   Nunca acceder a internals del bundle ni importar código del repo del player.

4. **Separar capas** — cada tipo de test valida una sola cosa.
   Un E2E no valida parsing. Un test de beacons no valida UI.

5. **Test data controlada** — nunca depender de streams de producción.
   Usar streams públicos conocidos (Bitmovin, Axinom, Mux test) o mock servers locales.

## Pirámide de Testing

```
Cross-Device (TV, Mobile real)    ← Por release, Bitmovin Stream Lab
Visual Regression + A11y          ← Cada PR, Playwright screenshots + axe-core
E2E Tests                         ← Cada PR, Playwright 3 browsers
Integration Tests                 ← Cada PR, Playwright + Chaos Proxy + mock VAST
Unit Tests                        ← Sugeridos al repo del player (Vitest)
```

## Qué NO hacer

- No usar `page.waitForTimeout()` como sustituto de esperar eventos reales
  (excepto para simular tiempo de reproducción)
- No hard-codear selectores CSS internos del player (pueden cambiar)
  — usar aria-labels, data-testid, o la API pública
- No correr tests contra streams de producción
- No commitear archivos `.env` con credenciales
- No ignorar tests flaky — investigar la causa raíz

## Flaky Test Protocol

Si un test falla intermitentemente:
1. No aumentar el timeout como solución
2. Identificar si es problema del stream, del player, o del test
3. Usar `test.skip` con nota explicativa si es problema externo
4. Usar `expect.poll` en lugar de `waitForTimeout` + assert

## Streams de Test

Ver `fixtures/streams.ts` para el catálogo completo.
Regla: si un stream de test deja de funcionar, actualizar `streams.ts`,
no cambiar el test para trabajar alrededor del problema.
