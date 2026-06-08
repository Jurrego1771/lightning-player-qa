/**
 * learning-store.ts
 *
 * Interfaz unificada de lectura/escritura para agent_learnings.
 * Los agentes leen de aquí ANTES de llamar al LLM — más señal, menos ruido.
 *
 * Fuentes:
 *   - PostgreSQL: agent_learnings (patrones explícitos)
 *   - PostgreSQL: risk_signals (calibración histórica)
 *   - Neo4j: defects relacionados (si disponible)
 */

import { Client as PgClient } from "pg"
import * as dotenv from "dotenv"
import { getDefectsForModules } from "../retrieval/graph-retrieval"

dotenv.config()

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface Learning {
  id: number
  feature: string
  module_id: string
  pattern: string
  context: Record<string, unknown>
  confidence: number    // 0-1
  source: string        // "evaluator" | "risk-calibrator" | "human"
  created_at: string
}

export interface RiskSignal {
  module_id: string
  signal: string
  value: number
  measured_at: string
}

export interface ModuleMemory {
  module_id: string
  learnings: Learning[]
  risk_signals: RiskSignal[]
  open_defect_count: number
  dominant_pattern?: string   // patrón más frecuente
  confidence_aggregate: number
}

// ─── Helpers de conexión ──────────────────────────────────────────────────────

function pgClient(): PgClient {
  return new PgClient({
    host:     process.env.POSTGRES_HOST ?? "localhost",
    port:     Number(process.env.POSTGRES_PORT ?? 5432),
    database: process.env.POSTGRES_DB ?? "qa_platform",
    user:     process.env.POSTGRES_USER ?? "qa_user",
    password: process.env.POSTGRES_PASSWORD ?? "qa_password",
  })
}

async function withPg<T>(fn: (c: PgClient) => Promise<T>): Promise<T | null> {
  const client = pgClient()
  try {
    await client.connect()
    return await fn(client)
  } catch { return null } finally { await client.end().catch(() => {}) }
}

// ─── Lectura ──────────────────────────────────────────────────────────────────

/**
 * Obtiene learnings relevantes para un conjunto de módulos/features.
 * Usado por risk-agent y test-selection antes de llamar al LLM.
 */
export async function getLearningsForModules(
  moduleIds: string[],
  opts: { minConfidence?: number; limit?: number } = {}
): Promise<Learning[]> {
  const minConf = opts.minConfidence ?? 0.5
  const limit   = opts.limit ?? 20

  const rows = await withPg(async c => {
    const res = await c.query<Learning>(
      `SELECT id, feature, module_id, pattern, context, confidence, source, created_at::text
       FROM agent_learnings
       WHERE module_id = ANY($1) AND confidence >= $2
       ORDER BY confidence DESC, created_at DESC
       LIMIT $3`,
      [moduleIds, minConf, limit]
    )
    return res.rows
  })

  return rows ?? []
}

/**
 * Obtiene learnings por feature (nombre de feature de negocio).
 */
export async function getLearningsForFeatures(
  features: string[],
  opts: { minConfidence?: number } = {}
): Promise<Learning[]> {
  const rows = await withPg(async c => {
    const res = await c.query<Learning>(
      `SELECT id, feature, module_id, pattern, context, confidence, source, created_at::text
       FROM agent_learnings
       WHERE feature = ANY($1) AND confidence >= $2
       ORDER BY confidence DESC, created_at DESC
       LIMIT 15`,
      [features, opts.minConfidence ?? 0.5]
    )
    return res.rows
  })
  return rows ?? []
}

/**
 * Señales de riesgo calibradas para un módulo.
 */
export async function getRiskSignals(moduleId: string): Promise<RiskSignal[]> {
  const rows = await withPg(async c => {
    const res = await c.query<RiskSignal>(
      `SELECT module_id, signal, value, measured_at::text
       FROM risk_signals
       WHERE module_id = $1
       ORDER BY measured_at DESC
       LIMIT 10`,
      [moduleId]
    )
    return res.rows
  })
  return rows ?? []
}

/**
 * Snapshot completo de memoria para un módulo.
 * Combina learnings + señales + defects del grafo.
 */
export async function getModuleMemory(moduleId: string): Promise<ModuleMemory> {
  const [learnings, signals, defects] = await Promise.all([
    getLearningsForModules([moduleId]),
    getRiskSignals(moduleId),
    getDefectsForModules([moduleId], { status: "open" }),
  ])

  // Patrón dominante: el más frecuente entre learnings de alta confianza
  const highConf = learnings.filter(l => l.confidence >= 0.8)
  let dominantPattern: string | undefined
  if (highConf.length > 0) {
    const freq = new Map<string, number>()
    for (const l of highConf) {
      const key = l.pattern.slice(0, 60)
      freq.set(key, (freq.get(key) ?? 0) + 1)
    }
    dominantPattern = [...freq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  }

  const confidenceAggregate = learnings.length > 0
    ? learnings.reduce((s, l) => s + l.confidence, 0) / learnings.length
    : 0

  return {
    module_id:            moduleId,
    learnings,
    risk_signals:         signals,
    open_defect_count:    (defects ?? []).length,
    dominant_pattern:     dominantPattern,
    confidence_aggregate: Math.round(confidenceAggregate * 100) / 100,
  }
}

// ─── Escritura ────────────────────────────────────────────────────────────────

export interface LearningWrite {
  feature: string
  module_id: string
  pattern: string
  context?: Record<string, unknown>
  confidence?: number
  source?: string
}

export async function writeLearning(l: LearningWrite): Promise<void> {
  await withPg(async c => {
    await c.query(
      `INSERT INTO agent_learnings (feature, module_id, pattern, context, confidence, source)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [l.feature, l.module_id, l.pattern, JSON.stringify(l.context ?? {}), l.confidence ?? 0.7, l.source ?? "system"]
    )
    return null
  })
}

export async function upsertRiskSignal(
  moduleId: string,
  signal: string,
  value: number
): Promise<void> {
  await withPg(async c => {
    await c.query(
      `INSERT INTO risk_signals (module_id, signal, value, measured_at)
       VALUES ($1, $2, $3, NOW())`,
      [moduleId, signal, value]
    )
    return null
  })
}

// ─── Formateo para prompts ────────────────────────────────────────────────────

/**
 * Convierte ModuleMemory en texto para prompt de LLM.
 * Usado por risk-agent para enriquecer contexto sin inflar tokens.
 */
export function formatMemoryForPrompt(memories: ModuleMemory[]): string {
  if (memories.length === 0) return "(sin historial previo)"

  return memories.map(m => {
    const lines: string[] = [`Módulo ${m.module_id}:`]
    if (m.dominant_pattern) lines.push(`  Patrón dominante: ${m.dominant_pattern}`)
    if (m.open_defect_count > 0) lines.push(`  Bugs abiertos: ${m.open_defect_count}`)
    if (m.risk_signals.length > 0) {
      const sigs = m.risk_signals.slice(0, 3).map(s => `${s.signal}=${s.value.toFixed(2)}`).join(", ")
      lines.push(`  Señales de riesgo: ${sigs}`)
    }
    if (m.learnings.length > 0) {
      const top = m.learnings.slice(0, 3).map(l => `    - ${l.pattern} (conf: ${l.confidence})`)
      lines.push("  Learnings:", ...top)
    }
    return lines.join("\n")
  }).join("\n\n")
}
