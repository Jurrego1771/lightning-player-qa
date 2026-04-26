# Tutorial de Agentes — lightning-player-qa

Guía práctica de cuándo y cómo usar cada agente o comando.

---

## Mapa rápido

```
¿Qué quieres hacer?
│
├── Validar un PR/commit del player           → /review-diff
├── Documentar una feature nueva              → /doc-feature [feature] create
├── Investigar tests que fallaron             → test-triage-agent (automático o manual)
├── Corregir tests rotos ya clasificados      → test-defect-corrector (automático)
├── Sincronizar conocimiento del player       → /sync-knowledge
└── Cerrar sesión y guardar learnings         → /session-review
```

---

## Escenario 1 — Validar un PR o commit del player

**Cuándo:** llega un cambio al player y quieres saber si algo se rompió o si falta cobertura.

**Comando:**
```
/review-diff 42                    → PR número 42
/review-diff feature/pip-mode      → rama vs main
/review-diff abc1234               → commit específico
/review-diff                       → último commit en main
/review-diff --dry-run             → solo análisis, sin ejecutar tests
```

**Qué pasa internamente:**

```
Paso 0    Prepara entorno (tmp/pipeline/)
Paso 0.5  Script extrae el diff → diff-input.json
Paso 1    diff-analyzer       → risk-map.json  (qué cambió y qué riesgo tiene)
Paso 1.5  Doc check           → ¿existen docs para los módulos afectados?
Paso 2    coverage-checker    → coverage-report.json  (qué tests cubren esos módulos)
Paso 2.5  Test Charter        → tú apruebas el scope de cada gap MUST (PAUSA HUMANA)
Paso 3    test-generator      → nuevos .spec.ts si hay gaps MUST aprobados
Paso 4    test-selector       → test-plan.json  (comandos exactos a ejecutar)
Paso 5    Ejecución           → npx playwright test ...
Paso 6    results-analyzer    → results-report.json + veredicto
Paso 7    Limpieza            → guardar o limpiar tmp/pipeline/
```

**Tus decisiones (solo 3):**

| Paso | Pregunta | Si dices NO |
|---|---|---|
| 1.5 | ¿Continuar sin docs de feature? | Correr `/doc-feature` primero |
| 2.5 | ¿Apruebas el charter del gap? | Gap pospuesto, no se genera test |
| 4 | ¿Ejecutas el test plan? | Modo dry-run, solo el plan |

**Output final:**
```
Veredicto: SAFE TO MERGE / INVESTIGATE / DO NOT MERGE
Tests ejecutados: N (N passed, N failed)
Tests generados: N specs nuevos
```

---

## Escenario 2 — Documentar una feature nueva

**Cuándo:** el player agregó una feature nueva y quieres documentarla antes de generar tests.

**Prerequisito:** conocer el nombre de la feature y los archivos del player relacionados.

**Comando:**
```
/doc-feature next-episode create
```

**Qué genera:**
```
docs/02-features/next-episode/
├── business-rules.md   ← reglas canónicas (BR-NN), tabla de vistas, API, timing
├── observability.md    ← eventos, señales confiables, secuencias, NO-señales
├── test-briefs.md      ← casos a testear (TB-NN) + anti-patrones
├── edge-cases.md       ← casos edge con [CODE: citations] y coverage status
└── _meta.json          ← versión, status:draft, coverage_status
```

**El agente:**
1. Lee el código fuente del player (`../lightning-player/src`)
2. Extrae comportamiento real con citations `[CODE: path:line]`
3. Investiga estándares de industria si aplica
4. Si código y estándar se contradicen → **para y pregunta** (no asume)
5. Escribe todo en `status: "draft"` — nunca auto-aprueba

**Para aprobar los docs:**
```
/doc-feature next-episode --approve
```
→ Cambia `status` a `"approved"`. Solo hacer cuando hayas revisado los claims.

**Después de crear docs, para generar tests:**
```
/review-diff feature/next-episode
```
→ Ahora el Paso 1.5 pasa sin warning y test-generator tiene contexto completo.

---

## Escenario 3 — Tests fallaron, quiero saber por qué

**Cuándo:** corriste `npm run test:integration` (o cualquier suite) y hay fallos.

**Cómo activar:** simplemente describir los fallos a Claude:
```
Acabo de correr npm run test:integration y fallaron 3 tests, revísalos
```

Claude lanza `test-triage-agent` automáticamente.

**Qué hace el agente (3 fases):**

```
DIAGNOSE
  1. Lee playwright-report/report.json
  2. Lee código fuente de cada test fallido
  3. Verifica known-bugs.json del feature → ¿bug ya conocido?
  4. Doc check → obtiene contrato de observability.md (soft — nunca bloquea)
  5. Corre el spec en los 3 browsers → tabla de distribución de fallos

OBSERVE
  Abre el player en un browser real via Playwright MCP
  Ejecuta la misma acción que el test
  Compara eventos observados vs contrato del observability.md

ACT
  Clasifica:
  ┌─ REAL BUG        → crea GitHub issue con evidencia MCP
  ├─ TEST DEFECT     → crea triage/test-corrections/YYYY-MM-DD_*.json
  ├─ BROWSER LIMIT   → agrega test.skip() + documenta en memory
  ├─ FLAKY           → nota + recomienda isolation
  └─ ENVIRONMENT     → instrucción de fix al usuario
```

**Reglas duras del agente:**
- Nunca clasifica sin MCP observation (ver el player real en browser)
- Si es bug conocido en known-bugs.json → no re-file
- Si es TEST DEFECT → no modifica el test sin aprobación

---

## Escenario 4 — Corregir tests rotos (post-triage)

**Cuándo:** hay archivos en `triage/test-corrections/` (los creó test-triage-agent).

**Cómo activar:**
```
hay tests rotos en triage, arréglalo
```

Claude lanza `test-defect-corrector` automáticamente.

**Qué hace el agente:**

```
Step 1  Lee todos los archivos en triage/test-corrections/
Step 2  Diagnose:
        - Lee el test fallido
        - Lee business-rules.md + observability.md del feature
        - Lee known-bugs.json → ¿es bug real disfrazado de defecto?
Step 3  Diseña el fix mínimo
Step 3b PAUSA: presenta plan al usuario y espera aprobación
Step 4  Implementa el fix
Step 5  Valida con Playwright:
        - Validación NEGATIVA: test falla con datos incorrectos ✓
        - Validación POSITIVA: test pasa 2 veces consecutivas ✓
Step 6  Elimina el triage file
```

**El agente NO procede si:**
- `known-bugs.json` tiene un bug open que coincide con el fallo (el test puede ser correcto, el player está roto)
- El usuario no aprueba el plan en Step 3b

---

## Escenario 5 — Sincronizar conocimiento del player

**Cuándo:** el player subió de versión o hubo cambios significativos en la API.

**Comando:**
```
/sync-knowledge
```

**Qué hace:**
1. Lee `player_system.md` y `testing_gaps.md` de la memoria
2. Lee el repo del player: `package.json`, `src/api/`, `constants.cjs`, `src/events/`, `src/ads/`
3. Detecta diffs: versión nueva, API agregada/removida, eventos nuevos, nuevos ad systems
4. Genera un reporte de cambios con recomendaciones
5. Espera tu aprobación antes de actualizar los archivos de memoria

---

## Escenario 6 — Cerrar sesión

**Cuándo:** al terminar una sesión de trabajo.

**Comando:**
```
/session-review
```

**Qué hace:**
Pregunta 6 cosas:
1. ¿Aprendiste algo no-obvio del player?
2. ¿Tomaste decisiones técnicas importantes?
3. ¿Algo no funcionó como esperabas?
4. ¿Qué gaps nuevos detectaste?
5. ¿Qué gaps resolviste?
6. ¿Qué quedó pendiente?

Luego guarda en el archivo correcto:
- Comportamiento del player → `player_system.md`
- Decisiones → `decisions.md`
- Gaps nuevos/resueltos → `testing_gaps.md`
- Learnings de sesión → `sessions/YYYY-MM-DD_tema.md`

---

## Referencia rápida de agentes

| Agente | Lo invoca | Input | Output |
|---|---|---|---|
| `diff-analyzer` | `/review-diff` (Paso 1) | `diff-input.json` | `risk-map.json` |
| `coverage-checker` | `/review-diff` (Paso 2) | `risk-map.json` | `coverage-report.json` + actualiza risk-map |
| `test-generator` | `/review-diff` (Paso 3) | `coverage-report.json` + `test-briefs.md` | `.spec.ts` |
| `test-selector` | `/review-diff` (Paso 4) | `risk-map.json` + `coverage-report.json` | `test-plan.json` |
| `results-analyzer` | `/review-diff` (Paso 6) | `report.json` + pipeline artifacts | `results-report.json` + actualiza risk-map |
| `doc-feature-agent` | `/doc-feature` (standalone) | player source code | 5 archivos en `docs/02-features/` |
| `test-triage-agent` | manual o automático post-fallo | `playwright-report/` + feature docs | GitHub issue o `triage/test-corrections/*.json` |
| `test-defect-corrector` | manual o automático post-triage | `triage/test-corrections/*.json` | fix en `.spec.ts` + delete triage file |

---

## Dependencias entre agentes

```
doc-feature-agent          ← corre ANTES del pipeline (prerequisito)
        │
        ▼
/review-diff pipeline:
  diff-analyzer
        │
  Paso 1.5 doc-check ─────── si faltan docs → /doc-feature o continuar en modo básico
        │
  coverage-checker ←── lee feature docs (business-rules, observability)
        │
  test-generator   ←── lee test-briefs.md (BLOQUEA si no existe y Mode B activo)
        │
  test-selector
        │
  [ejecución de tests]
        │
  results-analyzer
        │
        ▼
[si hay fallos]
  test-triage-agent ←── lee feature docs + known-bugs.json
        │
  [si es TEST DEFECT]
        ▼
  test-defect-corrector ←── lee triage doc + feature docs + known-bugs.json
```

---

## Errores comunes

**"test-generator generó tests genéricos sin contexto"**
→ Causa: no había `test-briefs.md` cuando corrió `/review-diff`.
→ Fix: correr `/doc-feature [módulo] create` y luego regenerar.

**"test-triage-agent quiere documentar el comportamiento antes de clasificar"**
→ Normal con soft doc gate. Si los docs no existen, procede usando `observability-model.md` como baseline. Solo pide docs cuando el comportamiento esperado es genuinamente ambiguo.

**"test-defect-corrector no corrige el test y deja el triage file"**
→ Causa probable: `known-bugs.json` tiene un bug open que coincide. El test puede ser correcto y el player está roto. Revisar el issue del player.

**"El pipeline falló en Paso 1.5 por docs faltantes"**
→ No es un error — es intencional. Opciones:
  a) `/doc-feature [módulo] create` (5-10 min) y luego retomar `/review-diff`
  b) Responder "s" para continuar en modo básico sin contexto de feature
