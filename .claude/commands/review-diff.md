---
name: review-diff
description: Pipeline completo de revisión de cambios. Analiza un diff/PR/commit, evalúa riesgos, verifica cobertura, genera tests faltantes y ejecuta la suite óptima. Usar cuando hay un cambio en el player que se quiere validar.
---

# /review-diff — Pipeline de Revisión de Cambios

Eres el orquestador del pipeline de QA automatizado para `lightning-player-qa`.
Tu trabajo es coordinar los agentes especializados y tomar decisiones entre cada paso.

## Cómo invocar este skill

```
/review-diff 42                       → analiza PR #42 del player (GitHub)
/review-diff feature/pip-mode         → analiza rama vs main (GitHub)
/review-diff abc1234                  → analiza un commit específico (GitHub)
/review-diff                          → analiza el último commit en main (GitHub)
/review-diff --qa                     → analiza cambios en este repo QA (local)
/review-diff --dry-run                → análisis sin ejecutar tests
```

**Fuente de datos:** GitHub API (siempre preferida — read-only, siempre actualizada).
Requiere `PLAYER_GITHUB_REPO` en `.env` (ej: `mediastream/lightning-player`).
Fallback a repo local si GitHub no está disponible.

## Paso 0 — Preparar el entorno

Antes de iniciar el pipeline, crea el directorio de trabajo:

```bash
mkdir -p tmp/pipeline
```

Confirma al usuario qué se va a analizar:
```
🚀 Iniciando pipeline /review-diff
   Input: [lo que el usuario especificó o "último commit del player"]
   Modo: [completo | dry-run]
```

## Paso 0.5 — Pre-procesar el diff (script)

**SIEMPRE ejecutar antes del agente diff-analyzer.** El script hace todo el fetching
y pre-procesamiento — el agente solo recibe datos ya estructurados.

```bash
bash scripts/prepare-diff.sh [input]
```

Donde `[input]` es exactamente lo que el usuario especificó:
- PR #42 → `bash scripts/prepare-diff.sh 42`
- Rama → `bash scripts/prepare-diff.sh feature/pip-mode`
- Commit → `bash scripts/prepare-diff.sh abc1234`
- Sin input → `bash scripts/prepare-diff.sh` (último commit en main)
- `--qa` → saltar este paso (es para cambios en el repo QA, no en el player)

**Si el script falla** (gh no autenticado, repo no encontrado):
```
⚠️  El script prepare-diff.sh falló.
    Opciones:
    a) Pegar el diff directamente — el agente lo analizará desde texto
    b) Verificar gh auth status y reintentar
```
En caso (a), continuar al Paso 1 pasando el diff al agente directamente.

**Si el script termina bien**, muestra brevemente:
```
✅ Diff pre-procesado: N archivos (M filtrados como ruido)
   Módulos: [lista]
```

## Paso 1 — Análisis de riesgo (diff-analyzer)

Delega al agente `diff-analyzer`:

> Lee tmp/pipeline/diff-input.json (ya generado por prepare-diff.sh) y produce
> tmp/pipeline/risk-map.json con el análisis de riesgo completo.

**Espera el resultado.** Muestra el risk map al usuario.

**Decisión de salida temprana:**
- Si `risk_level = LOW` y `change_type = docs` → informar al usuario y preguntar si continuar
- Si el agente no puede obtener el diff → pedir al usuario que lo proporcione directamente

## Paso 1.5 — Doc check (prerequisito de test-generator)

Para cada módulo en `risk-map.affected_modules`, verifica si existe `docs/02-features/[módulo]/_meta.json`:

```bash
# Para cada módulo afectado:
ls docs/02-features/[módulo]/_meta.json 2>/dev/null
```

Si **todos los módulos tienen docs** → continuar en silencio.

Si **algún módulo NO tiene docs**, mostrar:

```
⚠️  Docs de feature faltantes para: [módulo1], [módulo2]

   test-generator necesita test-briefs.md para generar tests con contexto.
   Sin docs, solo puede generar basado en el diff (cobertura genérica).

   Opciones:
     a) Correr /doc-feature [módulo] create primero — recomendado (5-10 min)
     b) Continuar sin docs — test-generator opera en modo básico

   ¿Continuar sin docs? [s/N]
```

- Si NO → detener aquí. El usuario corre `/doc-feature` y luego retoma `/review-diff`.
- Si SÍ → continuar. Anotar en el resumen final cuáles módulos corrieron sin docs.

## Paso 2 — Verificación de cobertura (coverage-checker)

Delega al agente `coverage-checker`:

> Lee tmp/pipeline/risk-map.json y evalúa la cobertura existente en tests/.
> Produce tmp/pipeline/coverage-report.json.

**Espera el resultado.** Muestra el coverage report al usuario.

**Decisión:**
- Si `action = run-existing` → ir al Paso 4 directamente (saltar generación)
- Si `action = generate-then-run` → ir al Paso 3
- Si `action = run-existing-and-generate` → ir al Paso 3, luego Paso 4

## Paso 3 — Generación de tests (si hay gaps MUST)

⚠️ **Solo ejecutar si hay gaps con priority MUST en coverage-report.json**

Delega al agente `test-generator`:

> Lee tmp/pipeline/coverage-report.json y tmp/pipeline/risk-map.json.
> Genera los specs indicados en specs_to_generate con priority MUST.
> Sigue las convenciones del proyecto estrictamente.

**Espera el resultado.** Muestra los archivos generados.

**Confirmar con el usuario:**
```
Se generaron N specs nuevos:
- tests/e2e/nombre.spec.ts (3 tests)
- tests/integration/nombre.spec.ts (2 tests)

¿Proceder a ejecutar la suite incluyendo estos tests? [S/n]
```

Si el usuario dice NO → detenerse aquí, entregar los specs para revisión manual.

## Paso 4 — Selección de suite (test-selector)

Delega al agente `test-selector`:

> Lee tmp/pipeline/risk-map.json y tmp/pipeline/coverage-report.json.
> Produce tmp/pipeline/test-plan.json con los comandos exactos a ejecutar.

**Espera el resultado.** Muestra el plan al usuario:

```
📋 Test Plan (N pasos, ~X minutos):
1. [BLOQUEANTE] contract validation
2. integration/ad-beacons
3. smoke

¿Ejecutar? [S/n] o [m]odificar
```

Si el usuario dice NO → modo --dry-run, entregar el plan sin ejecutar.
Si el usuario dice [m]odificar → preguntar qué pasos agregar/quitar.

## Paso 5 — Ejecución de la suite

Si el usuario aprobó, ejecutar los comandos de `test-plan.json` en orden:

Para cada paso en `steps`:

```
▶ Paso N/N: [label]
  Comando: [comando]
```

Ejecutar el comando. Si `blocking: true` y el paso falla:
```
⛔ El paso [N] falló y es bloqueante.
   Los pasos siguientes no se ejecutarán.
   Razón: [error]

   Puedes:
   a) Investigar el fallo y corregirlo, luego continuar manualmente
   b) Omitir este paso y continuar de todas formas (arriesgado)
   ¿Qué prefieres?
```

Mientras los pasos no sean bloqueantes, continuar aunque alguno falle.
Mostrar progreso en tiempo real si es posible.

## Paso 6 — Análisis de resultados (results-analyzer)

Delega al agente `results-analyzer`:

> Lee tmp/pipeline/risk-map.json, tmp/pipeline/coverage-report.json,
> tmp/pipeline/test-plan.json y playwright-report/report.json.
> Produce tmp/pipeline/results-report.json y presenta el informe ejecutivo.

**Espera el resultado.** El agente presenta el informe completo.

## Paso 7 — Limpieza y cierre

Preguntar al usuario:
```
¿Guardar los archivos tmp/pipeline/ para referencia? [s/N]
```

Si NO → limpiar: `rm -rf tmp/pipeline/`
Si SÍ → mover a `pipeline-history/YYYY-MM-DD_HH-MM_<change-type>/`

Resumen final:
```
✅ Pipeline /review-diff completado

Veredicto: SAFE TO MERGE / INVESTIGATE / DO NOT MERGE
Tests ejecutados: N (N passed, N failed)
Tests generados: N specs nuevos
Tiempo total: X minutos

Próximos pasos: [según el veredicto]
```

## Modo --dry-run

En modo dry-run, ejecutar Pasos 1, 2 y 4 normalmente, pero en el Paso 5 mostrar
los comandos sin ejecutarlos y saltar al resumen final.
Útil para: revisar qué se va a correr antes de correrlo, planning, documentación.

## Manejo de errores

Si cualquier agente falla o produce output inválido:
1. Mostrar el error al usuario
2. Preguntar si continuar con el siguiente paso o detenerse
3. Nunca asumir ni inventar resultados de agentes

Si no hay diff disponible (player repo no accesible):
```
⚠️  No se puede acceder al player repo en D:\repos\mediastream\lightning-player
    Opciones:
    a) Proporcionar el diff directamente (pega el output de git diff)
    b) Especificar una ruta diferente al repo del player
    c) Analizar cambios en este repo QA (--qa)
```
