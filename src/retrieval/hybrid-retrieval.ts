/**
 * hybrid-retrieval.ts
 *
 * Combina búsqueda vectorial (Qdrant) + búsqueda estructural (Neo4j).
 * Entrypoint único para todos los agentes — abstraen la infraestructura.
 *
 * Estrategia de merge:
 *   1. Graph search  → resultado exacto (relaciones conocidas)
 *   2. Vector search → resultado semántico (similaridad)
 *   3. Merge por módulo, deduplicar, rankear por (graph_match × 2 + vector_score)
 */

import {
  searchKnowledge,
  searchTestCorpus,
  searchSimilarACs,
  type VectorHit,
} from "./vector-retrieval"

import {
  getModuleDependencyChain,
  getDependents,
  getDefectsForModules,
  getACsForModules,
  getUncoveredACs,
  getTestCoverage,
  getRelatedModulesViaDefects,
  type GraphDefect,
  type GraphAC,
  type GraphTestCoverage,
} from "./graph-retrieval"

// ─── Tipos de salida ──────────────────────────────────────────────────────────

export interface HybridContext {
  // Para Change Analysis / Risk Agent
  relatedModules:     string[]          // deps + impactados transitivamente
  historicalDefects:  GraphDefect[]     // bugs reales del grafo
  semanticChunks:     VectorHit[]       // chunks similares de Qdrant
  // Para Test Selection / Evaluator
  uncoveredACs:       GraphAC[]         // ACs sin tests en el grafo
  existingCoverage:   GraphTestCoverage[] // tests que ya cubren estos módulos
  // Métricas de retrieval
  graph_available:    boolean
  vector_available:   boolean
}

export interface TestSelectionContext {
  candidateSpecs:   Array<{ spec_file: string; score: number; reason: string }>
  uncoveredACIds:   string[]
  coverageBySpec:   Map<string, string[]>  // spec → [acIds cubiertos]
}

// ─── Retrieval para Risk Agent ────────────────────────────────────────────────

export async function getRiskContext(
  affectedModules: string[],
  changeSummary:   string
): Promise<HybridContext> {
  // Graph: deps transitivas + defectos históricos
  const [depsResults, dependents, defects, relatedViaDefects] = await Promise.all([
    Promise.all(affectedModules.map(m => getModuleDependencyChain(m, 3))),
    Promise.all(affectedModules.map(m => getDependents(m))),
    getDefectsForModules(affectedModules, { status: "open" }),
    Promise.all(affectedModules.map(m => getRelatedModulesViaDefects(m))),
  ])

  const transitiveModules = new Set<string>(affectedModules)
  for (const chain of depsResults.flat()) transitiveModules.add(chain.module)
  for (const dep of dependents.flat())   transitiveModules.add(dep)
  for (const rel of relatedViaDefects.flat()) transitiveModules.add(rel)
  transitiveModules.forEach(m => affectedModules.includes(m) || null)  // no-op, just for clarity

  // Vector: chunks semánticos relacionados con el cambio
  const semanticChunks = await searchKnowledge(changeSummary, {
    limit: 8,
    filter: { must: [{ key: "module", match: { any: [...transitiveModules] } }] },
  })

  const graphAvailable = defects !== null || depsResults.flat().length > 0
  const vectorAvailable = semanticChunks.length > 0

  return {
    relatedModules:    [...transitiveModules],
    historicalDefects: defects ?? [],
    semanticChunks,
    uncoveredACs:      [],   // no relevante para riesgos
    existingCoverage:  [],
    graph_available:   graphAvailable,
    vector_available:  vectorAvailable,
  }
}

// ─── Retrieval para Test Selection ───────────────────────────────────────────

export async function getTestSelectionContext(
  affectedModules: string[],
  features:        string[]
): Promise<TestSelectionContext> {
  // Graph: ACs MUST sin cobertura + tests existentes
  const [uncoveredACs, existingCoverage] = await Promise.all([
    getUncoveredACs(affectedModules, { priority: "MUST" }),
    getTestCoverage({ moduleIds: affectedModules }),
  ])

  // Vector: buscar specs similares por feature
  const vectorQuery = features.join(" ") + " " + affectedModules.join(" ")
  const vectorHits = await searchTestCorpus(vectorQuery, {
    limit: 15,
    modules: affectedModules,
  })

  // Merge: combinar cobertura del grafo con hits vectoriales
  const coverageBySpec = new Map<string, string[]>()
  for (const cov of (existingCoverage ?? [])) {
    coverageBySpec.set(cov.spec_file, cov.covered_acs)
  }

  // Score compuesto: graph_match × 2 + vector_score
  const specScores = new Map<string, number>()
  const specReasons = new Map<string, string>()

  for (const cov of (existingCoverage ?? [])) {
    const current = specScores.get(cov.spec_file) ?? 0
    specScores.set(cov.spec_file, current + 2)
    specReasons.set(cov.spec_file, "graph: módulo/AC match")
  }
  for (const hit of vectorHits) {
    const specFile = hit.payload.spec_file as string ?? String(hit.id)
    const current = specScores.get(specFile) ?? 0
    specScores.set(specFile, current + hit.score)
    if (!specReasons.has(specFile)) specReasons.set(specFile, "vector: semantic match")
  }

  const candidateSpecs = [...specScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([spec_file, score]) => ({
      spec_file,
      score,
      reason: specReasons.get(spec_file) ?? "unknown",
    }))

  return {
    candidateSpecs,
    uncoveredACIds: (uncoveredACs ?? []).map(ac => ac.id),
    coverageBySpec,
  }
}

// ─── Retrieval para Evaluator ─────────────────────────────────────────────────

export async function getEvaluatorContext(
  acIds: string[],
  affectedModules: string[]
): Promise<{ graphACs: GraphAC[]; similarACs: VectorHit[] }> {
  const [graphACs, similarACs] = await Promise.all([
    getACsForModules(affectedModules),
    searchSimilarACs(acIds.join(" "), { modules: affectedModules, limit: 10 }),
  ])

  return {
    graphACs:   graphACs ?? [],
    similarACs: similarACs ?? [],
  }
}

// ─── Retrieval para Change Analysis ──────────────────────────────────────────

export async function getSimilarPastChanges(
  changeSummary: string,
  affectedModules: string[]
): Promise<VectorHit[]> {
  return searchKnowledge(changeSummary, {
    limit: 5,
    filter: affectedModules.length
      ? { must: [{ key: "module", match: { any: affectedModules } }] }
      : undefined,
  })
}
