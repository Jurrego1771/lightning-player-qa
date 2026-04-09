---
name: session-review
description: Protocolo de cierre de sesión. Guarda learnings, decisiones y pendientes en los archivos de memoria correctos.
---

# /session-review — Cierre de Sesión

Eres el protocolo de cierre de sesión para `lightning-player-qa`.
Tu trabajo es capturar el conocimiento generado en esta sesión y guardarlo en el lugar correcto
para que futuras sesiones tengan acceso a él.

## Paso 1 — Inventario de la sesión

Repasa mentalmente todo lo que pasó en esta conversación y responde estas preguntas
(no las respondas en voz alta, solo úsalas para organizar lo que vas a guardar):

1. ¿Descubriste algo sobre el player que no estaba documentado o que contradecía lo documentado?
2. ¿Tomaste alguna decisión técnica sobre cómo testear algo? ¿Por qué?
3. ¿Algún test falló por una razón no obvia? ¿Cómo lo resolviste?
4. ¿Hay streams, ContentIds, o mocks que dejaron de funcionar?
5. ¿Quedó trabajo pendiente para la próxima sesión?

## Paso 2 — Clasificar qué guardar y dónde

| Si aprendiste... | Guardar en... |
|---|---|
| Comportamiento del player no documentado | `player_system.md` (actualizar) |
| Detalle de arquitectura interna | `player_architecture.md` (actualizar) |
| Gap de testing nuevo | `testing_gaps.md` (agregar ítem) |
| Gap resuelto | `testing_gaps.md` (marcar ✅) |
| Decisión técnica ("elegimos X sobre Y porque...") | `decisions.md` (agregar sección) |
| Stream/ContentId que no funciona | `player_system.md` + nota en streams.ts |
| Aprendizaje general de la sesión | `sessions/YYYY-MM-DD_tema.md` (nuevo archivo) |

## Paso 3 — Crear archivo de sesión (si hubo aprendizajes significativos)

Si la sesión tuvo aprendizajes que no encajan perfectamente en los archivos existentes,
crea un archivo de sesión:

```
.claude/memory/sessions/2026-MM-DD_tema-breve.md
```

Con este formato:
```markdown
---
name: [Título descriptivo]
description: [Una línea que explica qué se aprendió]
type: project
---

# [Tema] — [Fecha]

## Qué hicimos
[Descripción breve de la actividad]

## Hallazgos importantes
[Lista de lo que descubrimos que sea no-obvio]

## Decisiones tomadas
[Decisiones y su justificación]

## Problemas encontrados y soluciones
[Qué no funcionó y cómo se resolvió]

## Pendiente para próxima sesión
[Lista priorizada de lo que quedó por hacer]
```

## Paso 4 — Actualizar testing_gaps.md

Para cada gap resuelto en esta sesión, cambia el estado de ⬜ a ✅ y agrega una nota:
```
**Estado:** ✅ Implementado el YYYY-MM-DD en tests/integration/nombre.spec.ts
```

Para cada gap nuevo descubierto, agrega un nuevo ítem al final del archivo.

## Paso 5 — Actualizar MEMORY.md

Si creaste archivos nuevos de memoria, agrégalos al índice en `MEMORY.md`.
Mantén el índice bajo 200 líneas — si crece demasiado, consolida los archivos más viejos.

## Paso 6 — Confirmar al usuario

Presenta un resumen de qué guardaste y dónde:

```
## Session Review completado

### Guardado en:
- [archivo]: [qué se guardó]
- ...

### Gaps actualizados:
- Gap N: [de ⬜ a ✅] / [nuevo gap agregado]

### Pendiente para próxima sesión:
1. [ítem priorizado]
2. ...
```

## Cuándo correr este skill

Al final de cada sesión de trabajo en este proyecto.
El hook de Stop en `.claude/settings.json` lo recuerda automáticamente.
