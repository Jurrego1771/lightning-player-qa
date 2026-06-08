/**
 * graph-retrieval.ts
 *
 * Queries tipadas contra Neo4j para retrieval estructural.
 *
 * Queries principales:
 *   getModuleDependencyChain  — módulo + todas sus deps transitivas
 *   getDefectsForModules      — bugs históricos de módulos afectados
 *   getACsForModules          — ACs (especialmente MUST) de módulos
 *   getTestCoverage           — qué tests cubren qué ACs/módulos
 *   getUncoveredACs           — ACs sin ningún test que los cubra
 *   getRelatedModulesViaDefects — módulos que comparten bugs
 */

import neo4j, { Driver, Session, Record as NeoRecord } from "neo4j-driver"
import * as dotenv from "dotenv"

dotenv.config()

// ─── Driver singleton ─────────────────────────────────────────────────────────

let _driver: Driver | null = null

function getDriver(): Driver {
  if (!_driver) {
    _driver = neo4j.driver(
      process.env.NEO4J_URI ?? "bolt://localhost:7687",
      neo4j.auth.basic(
        process.env.NEO4J_USER ?? "neo4j",
        process.env.NEO4J_PASSWORD ?? "qa_password"
      )
    )
  }
  return _driver
}

async function withSession<T>(fn: (session: Session) => Promise<T>): Promise<T | null> {
  let session: Session | null = null
  try {
    session = getDriver().session()
    return await fn(session)
  } catch {
    return null  // Neo4j no disponible — graceful fallback
  } finally {
    await session?.close()
  }
}

// ─── Tipos de resultado ───────────────────────────────────────────────────────

export interface GraphModule {
  id: string
  risk_label: string
  risk_score: number
  criticality: string
}

export interface GraphAC {
  id: string
  scenario: string
  priority: string
  given: string
  when: string
  then: string
  module_id: string
}

export interface GraphDefect {
  id: string
  description: string
  severity: string
  status: string
  workaround: string
  found_in_module: string
}

export interface GraphTestCoverage {
  spec_file: string
  covered_acs: string[]
  covered_modules: string[]
}

export interface DependencyChain {
  module: string
  depth: number
  path: string[]
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Obtiene la cadena transitiva de dependencias de un módulo (max 4 hops).
 * Útil para saber qué otros módulos se pueden romper.
 */
export async function getModuleDependencyChain(
  moduleId: string,
  maxDepth = 4
): Promise<DependencyChain[]> {
  return await withSession(async session => {
    const res = await session.run(
      `MATCH path = (start:Module {id: $id})-[:DEPENDS_ON*1..${maxDepth}]->(dep:Module)
       RETURN dep.id AS module,
              length(path) AS depth,
              [n IN nodes(path) | n.id] AS chain`,
      { id: moduleId }
    )
    return res.records.map((r: NeoRecord) => ({
      module: r.get("module") as string,
      depth:  (r.get("depth") as number),
      path:   r.get("chain") as string[],
    }))
  }) ?? []
}

/**
 * Módulos que dependen DEL módulo dado (impacto hacia arriba).
 */
export async function getDependents(moduleId: string): Promise<string[]> {
  return await withSession(async session => {
    const res = await session.run(
      `MATCH (dep:Module)-[:DEPENDS_ON]->(m:Module {id: $id})
       RETURN dep.id AS id`,
      { id: moduleId }
    )
    return res.records.map(r => r.get("id") as string)
  }) ?? []
}

/**
 * Bugs históricos de un conjunto de módulos.
 * Filtro opcional por status: "open" | "closed"
 */
export async function getDefectsForModules(
  moduleIds: string[],
  opts: { status?: string } = {}
): Promise<GraphDefect[]> {
  return await withSession(async session => {
    const where = opts.status ? "WHERE d.status = $status" : ""
    const res = await session.run(
      `MATCH (d:Defect)-[:FOUND_IN]->(m:Module)
       WHERE m.id IN $ids ${where}
       RETURN d.id AS id, d.description AS description,
              d.severity AS severity, d.status AS status,
              d.workaround AS workaround, m.id AS found_in_module`,
      { ids: moduleIds, status: opts.status ?? null }
    )
    return res.records.map(r => ({
      id:              r.get("id") as string,
      description:     r.get("description") as string,
      severity:        r.get("severity") as string,
      status:          r.get("status") as string,
      workaround:      r.get("workaround") as string,
      found_in_module: r.get("found_in_module") as string,
    }))
  }) ?? []
}

/**
 * ACs de un conjunto de módulos, opcionalmente filtrados por prioridad.
 */
export async function getACsForModules(
  moduleIds: string[],
  opts: { priority?: "MUST" | "SHOULD" | "COULD" } = {}
): Promise<GraphAC[]> {
  return await withSession(async session => {
    const where = opts.priority ? "AND a.priority = $priority" : ""
    const res = await session.run(
      `MATCH (a:AcceptanceCriteria)-[:BELONGS_TO]->(m:Module)
       WHERE m.id IN $ids ${where}
       RETURN a.id AS id, a.scenario AS scenario, a.priority AS priority,
              a.given AS given, a.when AS when, a.then AS then,
              m.id AS module_id`,
      { ids: moduleIds, priority: opts.priority ?? null }
    )
    return res.records.map(r => ({
      id:        r.get("id") as string,
      scenario:  r.get("scenario") as string,
      priority:  r.get("priority") as string,
      given:     r.get("given") as string,
      when:      r.get("when") as string,
      then:      r.get("then") as string,
      module_id: r.get("module_id") as string,
    }))
  }) ?? []
}

/**
 * ACs que NO tienen ningún test que los cubra.
 * Core del gap analysis desde el grafo.
 */
export async function getUncoveredACs(
  moduleIds: string[],
  opts: { priority?: "MUST" | "SHOULD" } = {}
): Promise<GraphAC[]> {
  return await withSession(async session => {
    const where = opts.priority ? "AND a.priority = $priority" : ""
    const res = await session.run(
      `MATCH (a:AcceptanceCriteria)-[:BELONGS_TO]->(m:Module)
       WHERE m.id IN $ids ${where}
       AND NOT EXISTS { MATCH (t:Test)-[:COVERS_AC]->(a) }
       RETURN a.id AS id, a.scenario AS scenario, a.priority AS priority,
              a.given AS given, a.when AS when, a.then AS then,
              m.id AS module_id`,
      { ids: moduleIds, priority: opts.priority ?? null }
    )
    return res.records.map(r => ({
      id:        r.get("id") as string,
      scenario:  r.get("scenario") as string,
      priority:  r.get("priority") as string,
      given:     r.get("given") as string,
      when:      r.get("when") as string,
      then:      r.get("then") as string,
      module_id: r.get("module_id") as string,
    }))
  }) ?? []
}

/**
 * Tests que cubren módulos o ACs específicos.
 */
export async function getTestCoverage(
  opts: { moduleIds?: string[]; acIds?: string[] }
): Promise<GraphTestCoverage[]> {
  return await withSession(async session => {
    const res = await session.run(
      `MATCH (t:Test)
       WHERE (
         EXISTS { MATCH (t)-[:COVERS_MODULE]->(m:Module) WHERE m.id IN $module_ids }
         OR
         EXISTS { MATCH (t)-[:COVERS_AC]->(a:AcceptanceCriteria) WHERE a.id IN $ac_ids }
       )
       WITH t
       OPTIONAL MATCH (t)-[:COVERS_AC]->(a:AcceptanceCriteria)
       OPTIONAL MATCH (t)-[:COVERS_MODULE]->(m:Module)
       RETURN t.spec_file AS spec_file,
              collect(DISTINCT a.id) AS covered_acs,
              collect(DISTINCT m.id) AS covered_modules`,
      {
        module_ids: opts.moduleIds ?? [],
        ac_ids:     opts.acIds ?? [],
      }
    )
    return res.records.map(r => ({
      spec_file:       r.get("spec_file") as string,
      covered_acs:     r.get("covered_acs") as string[],
      covered_modules: r.get("covered_modules") as string[],
    }))
  }) ?? []
}

/**
 * Módulos relacionados a través de bugs compartidos.
 * Si A y B tienen bugs del mismo tipo → probablemente se afectan mutuamente.
 */
export async function getRelatedModulesViaDefects(moduleId: string): Promise<string[]> {
  return await withSession(async session => {
    const res = await session.run(
      `MATCH (m:Module {id: $id})<-[:FOUND_IN]-(d:Defect)-[:FOUND_IN]->(related:Module)
       WHERE related.id <> $id
       RETURN DISTINCT related.id AS id`,
      { id: moduleId }
    )
    return res.records.map(r => r.get("id") as string)
  }) ?? []
}

/**
 * Snapshot del estado del grafo — útil para debugging y observabilidad.
 */
export async function getGraphStats(): Promise<Record<string, number>> {
  return await withSession(async session => {
    const res = await session.run(`
      MATCH (m:Module)              WITH count(m) AS modules
      MATCH (a:AcceptanceCriteria)  WITH modules, count(a) AS acs
      MATCH (d:Defect)              WITH modules, acs, count(d) AS defects
      MATCH (t:Test)                WITH modules, acs, defects, count(t) AS tests
      MATCH ()-[r:DEPENDS_ON]->()   WITH modules, acs, defects, tests, count(r) AS deps
      RETURN modules, acs, defects, tests, deps
    `)
    if (!res.records.length) return {}
    const r = res.records[0]
    const stats: Record<string, number> = {}
    stats["modules"]  = r.get("modules") as number
    stats["acs"]      = r.get("acs") as number
    stats["defects"]  = r.get("defects") as number
    stats["tests"]    = r.get("tests") as number
    stats["deps"]     = r.get("deps") as number
    return stats
  }) ?? {}
}

/**
 * Cierra el driver Neo4j. Llamar al fin del proceso si aplica.
 */
export async function closeDriver(): Promise<void> {
  if (_driver) {
    await _driver.close()
    _driver = null
  }
}
