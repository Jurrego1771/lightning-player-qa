---
scope: project-wide
last_verified: 2026-05-12
---

# Lightning Player QA — Core Knowledge

## Proyecto

Suite de automatización QA para el Mediastream Lightning Player. Proyecto externo — no es parte del repo del player.
SUT repo: `$PLAYER_LOCAL_REPO` · QA repo: `D:\Dev\Repos\jurrego1771\lightning-player-qa` · Player version: 1.0.62.

## Mapa de docs

| Ruta | Contenido |
|---|---|
| `docs/core.md` | Este archivo — conceptos, filosofía, reglas, glosario |
| `docs/02-features/00-index.md` | Inventario completo de features y API del player |
| `docs/02-features/konodrac.md` | Konodrac Mark Collector — pixel tracking CARTV |
| `docs/02-features/youbora.md` | Youbora NPAW analytics — beacons NQS/LMA |
| `docs/02-features/next-episode.md` | Auto-carga siguiente episodio |
| `docs/02-features/reels.md` | Vista vertical multi-player tipo TikTok |
| `docs/05-pipeline/` | Contrato del pipeline de generación de tests con IA |
| `docs/06-operations/` | Runbooks, arquitectura Claude-first |

## Flujo para documentar una feature nueva

Un único archivo compacto `docs/02-features/{feature}.md` que incluya:
- Activación / config path
- Vistas soportadas y comportamiento por vista
- Eventos públicos y API observable
- Reglas de negocio clave (state machines, guards, unicidad)
- Señales confiables vs no confiables
- Secuencias de eventos esperadas
- Edge cases clave (tabla)
- Anti-patrones
- Prioridades de testing (CRÍTICO / ALTO / MEDIO)

No generar tests nuevos sin que exista este documento para la feature.

## Glosario

| Término | Significado |
|---|---|
| `SUT` | System Under Test — el Lightning Player |
| `Observability` | Señales externas confiables para validar comportamiento |
| `Primary signal` | Señal más confiable para una aserción |
| `Secondary signal` | Señal de apoyo, no fuente principal |
| `False positive` | Test que pasa por señal incorrecta, timing o supuesto inválido |
| `Test brief` | Contrato mínimo (input, output, señal, justificación) antes de generar un test |
| `isolatedPlayer` | Fixture con plataforma mockeada + stream local — sin dependencias externas |
| `player` fixture | Fixture contra infra real (DEV/STAGING) — para E2E y performance |

## Jerarquía de señales (de más a menos confiable)

1. Eventos públicos documentados
2. Retornos de API pública
3. Estado visible en UI accesible (aria-label, visibilidad del contenedor)
4. Propiedades públicas estables
5. DOM interno o timing implícito

## Filosofía de testing

- **Determinismo sobre volumen.** 50 tests estables > 200 flaky.
- **Una aserción fuerte vale más que tres decorativas.**
- **No usar señales débiles como si fueran contrato.** Documentar antes de testear.
- **No mockear el browser.** HLS, DASH, MSE, EME requieren APIs nativas reales.
- **Separar capas.** E2E ≠ integration ≠ performance. No mezclar.

Cada test nuevo debe poder responder: qué input controlé, qué output espero, qué señal observo, por qué esa señal es válida, qué podría hacer que el test falle o pase por la razón incorrecta.

## Reglas de aserción

- No usar `waitForTimeout()` salvo que el tiempo sea parte del comportamiento validado.
- No validar solo que una función fue llamada si el comportamiento real es una transición de estado.
- No usar una señal eventual como aserción inmediata sin `expect.poll()`.
- Si la aserción se apoya en comportamiento observado y no estrictamente documentado, decirlo.

## Anti-patrones globales

- Generar tests directamente desde un diff sin revisar las reglas de negocio de la feature.
- Validar internals del DOM del player (clases CSS internas como `.msp-*`).
- Confundir "evento despachado" con "transición completada".
- Crear cobertura "verde" que en realidad depende de señales débiles.
- Usar `player.metadata` justo después de `load()` — es eventual, puede tener datos del contenido anterior.

## Decisión de mocking

| Tipo de test | Plataforma | Streams | Fixture |
|---|---|---|---|
| Integration / Visual / A11y | Mockeado (`page.route`) | Local (localhost:9001) | `isolatedPlayer` |
| E2E / Smoke / Performance | Real (DEV/STAGING) | CDN real | `player` + `ContentIds` |

## Cobertura

- La cobertura por feature (observable → reglas de negocio → edge cases) importa más que la cobertura de API.
- Un test no cuenta como cobertura útil si su señal principal es inestable o mal justificada.
- Todo gap importante debe linkear a una feature y a una estrategia de prueba.
