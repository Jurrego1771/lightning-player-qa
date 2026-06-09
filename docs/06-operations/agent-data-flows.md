# Agent Data Flows — QA Pipeline

> Referencia de decisiones de arquitectura. Cada sección describe un agente:
> qué recibe, qué infra consulta, qué emite, y cuándo se activa.

---

## Topología del pipeline

```
PR / commit / branch
        │
        ▼
  [A1] change-analysis          ~5s     100% determinista
        │
        ▼ ChangeAnalysisOutput
  [A2] risk-agent               ~45s    Sonnet LLM + Neo4j + Qdrant + PG
        │
        ▼ RiskAgentOutput
  [A3] dependency-agent         ~2s     100% determinista (context.yaml + git imports)
        │
        ▼ DependencyAgentOutput
  [A4] test-selection           ~4s     Determinista + Qdrant semantic scoring
        │
        ▼ TestSelectionOutput
  [A5] evaluator                ~4s     Determinista + Haiku LLM (solo si REGENERATE)
        │
        ├── PASS ──────────────────────────────────────── END
        │
        └── REGENERATE (retry ≤ 3) ──────────────────── [A4] test-selection (con feedback)
              │
              └── REGENERATE + retries agotados ──────── [A6] test-design  ~120–300s Sonnet
```

**Estado compartido:** `state/session_state.json`
**Observabilidad:** Langfuse trace por pipeline run
**Persistencia:** PostgreSQL `pipeline_runs`

---

## A1 — change-analysis-agent

**Archivo:** `src/agents/change-analysis-agent.ts`

### Input
```typescript
{ ref: string, type: "pr" | "commit" | "branch" | "release" }
```

### Proceso

| Paso | Qué hace | Herramienta |
|------|----------|-------------|
| 1 | Obtiene diff del PR/branch via GitHub API o git | `scripts/prepare-diff.ts` → `tmp/pipeline/diff-input.json` |
| 2 | Mapea archivos modificados → módulos | `risk_map.yaml` (campo `files` de cada módulo) |
| 3 | Mapea módulos → features de negocio | `FEATURE_ALIASES` (hardcoded, e.g. `ads-ima` → `google-ima-ads`) |
| 4 | Infiere plataformas por patrones regex en paths/patch | `PLATFORM_SIGNALS` (fairplay→ios, widevine→android, smarttv→tv) |
| 5 | Infiere servicios externos por módulo | `MODULE_TO_SERVICES` (youbora→npaw, ads-ima→google-ima) |
| 6 | Genera `change_summary` determinista | Módulos afectados + tipo de cambio del diff |
| 7 | Calcula `risk_signal` preliminar | `cross_cutting_risk` OR `criticality=critical` → high |

> **Sin LLM.** Haiku fue removido del hot path — ahorraba 20s pero el resultado
> era equivalente al mapeo determinista. Solo aplica si un nuevo módulo no tiene
> entrada en `FEATURE_ALIASES` (caso raro, y el fallback usa el nombre del módulo).

### Output — `ChangeAnalysisOutput`
```typescript
{
  ref: string
  ref_type: string
  features: string[]          // features de negocio afectadas
  platforms: string[]         // ["web", "ios", "android", "tv"]
  services: string[]          // ["google-ima", "hls.js", "youbora"]
  affected_modules: string[]  // módulos del risk_map afectados
  change_summary: string      // descripción ≤150 chars
  risk_signal: "high" | "medium" | "low"
  change_type: string         // "feature" | "fix" | "refactor" | "docs"
  cross_cutting: boolean      // toca múltiples módulos críticos simultáneamente
}
```

### Cuándo falla
- `prepare-diff.ts` requiere `GITHUB_TOKEN` en `.env` para PRs privados
- Si `ref` es un PR que ya no existe → error de GitHub API

---

## A2 — risk-agent

**Archivo:** `src/agents/risk-agent.ts`

### Input — `RiskAgentInput`
```typescript
{
  features, platforms, services, affected_modules,
  change_summary, change_type, cross_cutting
}
```

### Proceso

| Paso | Qué hace | Herramienta | Fallback si falla |
|------|----------|-------------|-------------------|
| 1 | Bugs históricos por módulo | PostgreSQL `SELECT FROM defects WHERE module_id = ANY(modules)` | `[]` continúa |
| 2 | Patrones aprendidos de sesiones previas | PostgreSQL `agent_learnings` via `learning-store.ts` | `[]` continúa |
| 3 | Deps transitivas + defectos del grafo | Neo4j via `graph-retrieval.getDefectsForModules()` + `getModuleDependencyChain()` | `{}` continúa |
| 4 | Chunks semánticos similares al cambio | Qdrant `knowledge_chunks` via `vector-retrieval.searchKnowledge()` | `[]` continúa |
| 5 | Riesgos base deterministas por módulo | `MODULE_RISK_MAP` (10 entradas hardcoded, verificadas en código fuente) | Siempre funciona |
| 6 | LLM genera lista final refinada de risks | **Sonnet** con: cambio + arquitectura player + riesgos base + contexto de retrieval | Usa riesgos base directamente |

**Retrieval híbrido (paso 3+4):**
```
Neo4j  → dependencias exactas + bugs reales del grafo   (graph_score × 2)
Qdrant → chunks semánticamente similares (behavior.json fragmentado) (vector_score × 1)
merge  → deduplicado por módulo, rankeado por score combinado
```

> **Cuello de botella:** Sonnet LLM ~35–40s. Neo4j + Qdrant agregan ~3–5s.
> El `PLAYER_ARCHITECTURE_CONTEXT` (3k tokens de patrones de riesgo del player)
> se envía siempre — es la base del razonamiento cruzado entre módulos.

### Output — `RiskAgentOutput`
```typescript
{
  risks: Array<{
    id: string                  // "R001"
    description: string         // técnico y específico al cambio
    severity: "critical" | "high" | "medium" | "low"
    category: "functional" | "security" | "performance" | "integration"
    related_modules: string[]
    historical_bugs: string[]   // IDs de defects encontrados en PG/Neo4j
    evidence: string            // archivo o patrón concreto que justifica el riesgo
  }>
}
```

---

## A3 — dependency-agent

**Archivo:** `src/agents/dependency-agent.ts`

### Input
```typescript
{ features: string[], affected_modules: string[] }
```

### Proceso (100% determinista, sin LLM)

| Paso | Qué hace | Herramienta |
|------|----------|-------------|
| 1 | Lee `context.yaml` de cada módulo afectado | `qa-knowledge/modules/{mod}/context.yaml` |
| 2 | Extrae `depends_on`, `depended_by`, `breaks_if_changed`, `external_dependencies` | YAML parse |
| 3 | Analiza imports reales del código fuente del player | `PLAYER_LOCAL_REPO` → grep imports en archivos del módulo |
| 4 | Cruza ambas fuentes, clasifica `source` | `"both"` si aparece en YAML y en imports, `"context_yaml"` o `"git_analysis"` |
| 5 | Asigna criticality a cada dep | `risk_map.yaml[dep].risk_label` |

> **Dos fuentes porque:** `context.yaml` es declarativo y puede desactualizarse.
> Los imports del código fuente son ground truth. Si `PLAYER_LOCAL_REPO` no está
> configurado en `.env`, solo usa YAML y marca `source: "context_yaml"`.

### Output — `DependencyAgentOutput`
```typescript
{
  dependencies: Array<{
    module: string
    type: "internal" | "external"
    criticality: "critical" | "high" | "medium" | "low"
    source: "context_yaml" | "git_analysis" | "both"
    breaks_if_changed: string[]
  }>
}
```

---

## A4 — test-selection-agent

**Archivo:** `src/agents/test-selection-agent.ts`

### Input
```typescript
{
  features, affected_modules, risks, dependencies,
  time_budget_minutes?,   // constraint CI (default: sin límite)
  evaluator_feedback?,    // mensajes del evaluador cuando es retry
  missing_criteria?,      // AC IDs sin cobertura (desde evaluador)
  missing_risks?,         // Risk IDs sin tests (desde evaluador)
}
```

### Proceso

| Paso | Qué hace | Herramienta |
|------|----------|-------------|
| 1 | Descubre todos los spec files del repo | Filesystem scan de `tests/` recursivo |
| 2 | Mapea cada spec → módulos con **evidencia directa** | `risk_map.yaml[mod].tests` + `behavior.json[ac].covered_by` |
| 3 | Mapea spec → módulos por **heurística de nombre** | `youbora.spec.ts` → módulo `youbora` (match por nombre de archivo) |
| 4 | Busca specs semánticamente relevantes | Qdrant `test_corpus` semantic search por módulos + features |
| 5 | Lee historial de flakiness | `state/flaky_registry.json` |
| 6 | Scorea cada spec | Fórmula de abajo |
| 7 | Filtra por `time_budget_minutes` si está seteado | Acumula `estimated_duration_ms` |
| 8 | Mapea specs → ACs y risks cubiertos | `behavior.json covered_by` lookup |

**Fórmula de scoring:**
```
score = SUITE_BASE[suite]          // contract=45, smoke=40, integration=30, e2e=25, visual=15
      + module_relevance × 25      // 1.0 evidencia directa | 0.5 heurístico | 0.3 semántico
      + risk_relevance × 20        // % risks críticos cubiertos por el spec
      - flakiness_penalty × 15     // flaky_count_30d > 5 → penaliza fuerte
```

**Tiempos estimados por suite (para `time_budget`):**
```
contract: 25s | smoke: 20s | integration: 90s | e2e: 180s | visual: 60s | a11y: 120s | perf: 300s
```

### Output — `TestSelectionOutput`
```typescript
{
  selected_tests: Array<{
    spec_file: string           // path relativo a ROOT
    test_name: string
    priority: number            // 1-100
    reason: string              // por qué fue seleccionado (para debugging)
    covers_risks: string[]      // IDs de risks del A2 que cubre
    covers_acs: string[]        // IDs de ACs de behavior.json que cubre
    estimated_duration_ms: number
  }>
  coverage_estimate: number     // % risks cubiertos por la selección total
  excluded_count: number        // specs descartados
  total_duration_ms: number
}
```

---

## A5 — evaluator-agent

**Archivo:** `src/agents/evaluator-agent.ts`

### Input
```typescript
{
  selected_tests: SelectedTest[]
  risks: Risk[]
  acceptance_criteria: string[]   // IDs de ACs con priority=MUST de módulos afectados
}
```

### Proceso

| Paso | Qué hace | Herramienta | LLM? |
|------|----------|-------------|------|
| 1 | Construye índice de ACs | Todos los `behavior.json` del repo | No |
| 2 | Verifica que cada `spec_file` existe en disco | `fs.existsSync()` | No |
| 3 | Verifica que cada `covers_acs` claim existe en índice | Map lookup | No |
| 4 | Verifica que cada `covers_risks` ID existe en el input | Set lookup | No |
| 5 | Calcula `hallucination_score` | `false_claims / total_claims` | No |
| 6 | Calcula `coverage` | `covered_risks.size / risks.length × 100` | No |
| 7 | Emite veredicto | `PASS` si coverage ≥ 85% AND hallucination < 10% | No |
| 8 | Genera feedback legible | **Haiku** — solo si REGENERATE, ≤4 mensajes | Solo si REGENERATE |

**Umbrales:**
- `PASS`: coverage ≥ 85% AND hallucination_score < 0.10
- `REGENERATE`: cualquier umbral no cumplido

**Por qué Graph RAG mejora el evaluador:**
Con Neo4j + Qdrant activos, el risk-agent (A2) genera risks más precisos basados en
defectos reales del grafo, no solo mapeo estático. Test-selection (A4) usa Qdrant
para encontrar specs semánticamente relevantes que cubren esos risks. El evaluador
ve coverage real más alto → menos REGENERATEs.

PR #719 sin infra: coverage 63% → REGENERATE × 4. Con infra: coverage 88% → PASS × 1.

### Output — `EvaluatorOutput`
```typescript
{
  coverage: number                    // 0-100
  missing_criteria: string[]          // AC IDs sin cobertura detectados
  missing_risks: string[]             // Risk IDs sin ningún test
  hallucination_score: number         // 0-1 (0 = ninguna claim falsa)
  traceability_score: number          // 0-1 (1 = todo trazable a evidence en disco)
  scenarios_audit: Array<{
    test_id: string
    covers_ac: string[]
    evidence_found: boolean           // spec_file existe en disco
    traceability: "verified" | "claimed" | "missing"
  }>
  verdict: "PASS" | "REGENERATE"
  feedback: string[]                  // solo si REGENERATE (generado por Haiku)
}
```

---

## A6 — test-design-agent

**Archivo:** `src/agents/test-design-agent.ts`

**Cuándo activa:** Solo si evaluador agota 3 retries Y quedan `missing_criteria` o `missing_risks`.

### Input
```typescript
{
  missing_criteria: string[]    // AC IDs sin ningún test que los cubra
  missing_risks: string[]       // Risk IDs sin tests
  features: string[]
  affected_modules: string[]
}
```

### Proceso

| Paso | Qué hace | Herramienta |
|------|----------|-------------|
| 1 | Resuelve AC IDs → registros completos (scenario, given/when/then) | `behavior.json` de todos los módulos |
| 2 | Agrupa ACs por módulo | Módulo del AC en behavior.json |
| 3 | Carga anti-patrones y known bugs del módulo | `behavior.json[test_anti_patterns]`, `behavior.json[known_bugs]` |
| 4 | Carga spec de referencia para calibrar estilo | Primer `.spec.ts` de `tests/integration/` (3k chars) |
| 5 | LLM diseña escenarios BDD + genera código Playwright | **Sonnet**, timeout 300s por módulo |
| 6 | Escribe spec a disco | `tests/integration/{module}-generated.spec.ts` |
| 7 | Valida que el spec parsea correctamente | `npx playwright test "{spec}" --list` |

**Convenciones obligatorias que el LLM debe seguir:**
- `import { test, expect } from '../../fixtures'` — nunca `@playwright/test`
- `waitForEvent('event', 15_000)` — nunca `waitForTimeout`
- Selectores `[aria-label]` o `[data-testid]` — nunca clases `.msp-*`
- `page.route()` siempre antes de `isolatedPlayer.goto()`
- `test.skip()` si el AC tiene `known_bug`

### Output — `TestDesignOutput`
```typescript
{
  scenarios: TestScenario[]       // metadatos BDD
  spec_drafts: Array<{
    spec_file: string
    module: string
    scenarios_count: number
    code: string                  // código Playwright generado
    written: boolean              // se escribió a disco
    validation_passed: boolean    // playwright --list pasó
    validation_error?: string
  }>
  covered_criteria: string[]
  covered_risks: string[]
  still_missing: string[]         // lo que el LLM no pudo cubrir
}
```

---

## Infraestructura

| Servicio | Puerto | Usado por | Sin él |
|----------|--------|-----------|--------|
| **PostgreSQL** | 5432 | A2 (bugs históricos, learnings), pipeline_runs | Agentes continúan sin datos históricos |
| **Qdrant** | 6333 | A4 (semantic spec scoring), A2 (semantic bugs) | A4 usa solo evidencia directa; A2 usa solo riesgos base |
| **Neo4j** | 7687 | A2 (deps transitivas + defectos del grafo) | A2 usa solo MODULE_RISK_MAP determinista |
| **Langfuse** | 3000 | Todos (observabilidad, spans por agente) | Pipeline corre sin tracing |

**Arrancar todo:**
```bash
docker compose up -d postgres qdrant neo4j
```

**Migración inicial (una sola vez por entorno):**
```bash
npx ts-node scripts/migrate-to-db.ts      # PG: 33 módulos, 219 ACs, 4 defectos
npx ts-node scripts/index-knowledge.ts    # Qdrant: 297 knowledge chunks + 629 test corpus
npx ts-node scripts/migrate-to-neo4j.ts  # Neo4j: grafo módulos/ACs/defectos/tests
```

---

## Flujo de retry

```
evaluator → REGENERATE
    │
    ├─ retry_count < 3
    │      │
    │      └─ → test-selection con:
    │               evaluator_feedback[]     (mensajes Haiku)
    │               missing_criteria[]       (AC IDs sin cobertura)
    │               missing_risks[]          (Risk IDs sin tests)
    │
    └─ retry_count >= 3 AND missing > 0
           │
           └─ → test-design (genera specs nuevos para los gaps)
```

**Stagnation detection (pendiente):** Si `selected_tests` del retry N es idéntico
al retry N-1, el loop no converge. Fix: comparar hash del set de spec_files entre
retries consecutivos; si igual → saltar a test-design directamente.

---

## Tiempos observados (PR #719, branch `feature/reels-tracking`)

| Agente | Sin Docker (infra muerta) | Con Docker (Graph RAG activo) |
|--------|--------------------------|-------------------------------|
| change-analysis | 24s (tenía Haiku LLM) | ~5s (determinista) |
| risk-agent | 55s | ~45s (Sonnet + Neo4j/Qdrant ~3s) |
| dependency-agent | 1.8s | ~2s |
| test-selection | 2.2s | ~4s (Qdrant semantic scoring) |
| evaluator | ~3s | ~3s |
| **Total** | **~86s + 3 retries = ~340s** | **~59s, 0 retries** |
| **Verdict** | REGENERATE, coverage 63% | **PASS, coverage 88%** |

---

## Cómo agregar un agente

1. Definir tipos en `src/agents/types.ts`
2. Crear `src/agents/{nombre}-agent.ts`:
   - `export async function run{Nombre}Agent(input: Input): Promise<Output>`
   - `startAgentTrace(name, input)` al inicio → `span.end(output)` al final
   - `span.error(err)` en catch
   - CLI block en `if (require.main === module)`
3. Agregar nodo en `src/pipeline/langgraph-pipeline.ts`
4. Agregar campo en `PipelineAnnotation` con `reducer: (_, b) => b`
5. Conectar con `.addEdge()` o `.addConditionalEdges()`
