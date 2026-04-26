---
name: doc-feature
description: Genera y actualiza documentación estructurada de features del Lightning Player. Infiere reglas desde código fuente del player + investigación de industria. Alerta y para cuando hay contradicciones. Alimenta el Documentation Gate del test-triage-agent.
---

# /doc-feature — Documentación de Features

Eres el orquestador del skill `/doc-feature`. Delega al agente `doc-feature-agent` según el modo.

## Modos de invocación

```
/doc-feature [feature]                      → create: genera 7 archivos desde cero
/doc-feature [feature] --update [archivo]   → update: actualiza un archivo específico
/doc-feature [feature] --approve            → approve: marca docs como aprobados
/doc-feature --list                         → list: muestra status de todas las features
```

### Ejemplos

```
/doc-feature analytics-first-play
/doc-feature analytics-first-play --update business-rules
/doc-feature analytics-first-play --approve
/doc-feature on-next-prev --update edge-cases
/doc-feature --list
```

## Paso 0 — Determinar modo

Parsea el input del usuario y determina:
- `feature`: nombre de la feature (kebab-case)
- `mode`: create | update | approve | list
- `target_file` (solo en update): qué archivo actualizar

Si el usuario escribió `/doc-feature analytics` sin flags → modo `create`.

## Paso 1 — Verificar estado actual

Antes de delegar, verifica si ya existen docs para la feature:

```
docs/02-features/[feature]/_meta.json
```

- Si **no existe** y modo es `create` → proceder
- Si **existe** y modo es `create` → alertar:

```
⚠️  docs/02-features/[feature]/ ya existe (v[X] — status: [Y])

¿Quieres:
  a) Sobrescribir (perder el contenido actual)
  b) Actualizar un archivo específico con --update
  c) Ver el status actual con --list
```

Esperar respuesta del usuario antes de continuar.

## Paso 2 — Modo LIST (sin delegación)

Ejecutar directamente sin agente:

```bash
ls docs/02-features/
```

Para cada carpeta, leer `_meta.json` y mostrar tabla:

```
Feature                  Status    Version  Updated
─────────────────────────────────────────────────────
analytics-first-play     draft     1.0.0    2026-04-26
next-episode             approved  2.1.0    2026-04-20
on-next-prev             approved  1.3.0    2026-04-15
```

## Paso 3 — Delegar al agente doc-feature-agent

Para modos create, update, approve, delega con este prompt:

> Modo: [create | update | approve]
> Feature: [feature-name]
> Target file (solo update): [archivo]
> 
> Contexto de la conversación actual:
> [resumir los claims ya confirmados por el usuario en esta sesión,
>  incluyendo investigación de industria realizada y confirmaciones explícitas]
>
> Ejecuta el modo indicado siguiendo tus directrices.
> Recuerda: nunca inferir sin evidencia, siempre citar fuente,
> parar en contradicciones.

**Espera el resultado.** El agente puede hacer preguntas durante la ejecución — relaylas al usuario y pasa las respuestas de vuelta.

## Paso 4 — Confirmar resultado

Al terminar, muestra al usuario:

```
✅ /doc-feature [modo] completado

Feature: [nombre]
Archivos generados/actualizados:
  - docs/02-features/[feature]/business-rules.md
  - docs/02-features/[feature]/_meta.json
  - ...

Status: draft (pendiente aprobación)
Claims sin confirmar: [N]

Próximo paso:
  → Revisa los docs generados
  → Cuando estés listo: /doc-feature [feature] --approve
  → El test-triage-agent los aceptará solo después de --approve
```

## Regla de integración con test-triage-agent

El triage-agent rechaza docs con `status !== "approved"`. El flujo correcto es:

```
/doc-feature [feature]           # genera draft
  → revisas los docs
/doc-feature [feature] --approve # aprueba
  → test-triage-agent puede proceder
```

No saltar el --approve aunque el contexto sea claro. Es la firma humana en el contrato.
