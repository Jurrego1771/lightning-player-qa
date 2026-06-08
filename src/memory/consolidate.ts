/**
 * consolidate.ts
 *
 * Consolida agent_learnings → extrae patrones → actualiza risk_signals.
 *
 * Ejecutar periódicamente (post-merge, post-pipeline):
 *   npx ts-node src/memory/consolidate.ts [--module <id>] [--dry-run]
 *
 * Qué hace:
 *   1. Agrupa learnings por módulo
 *   2. Detecta patrones recurrentes (≥2 menciones con confianza alta)
 *   3. Calcula señales derivadas: ac_gap_rate, defect_density, learning_velocity
 *   4. Escribe señales en risk_signals → disponibles para risk-calibrator (A11)
 *   5. Escribe learnings consolidados de vuelta en agent_learnings con source="consolidator"
 */

import { Client as PgClient } from "pg"
import * as dotenv from "dotenv"
import {
  getLearningsForModules,
  getRiskSignals,
  writeLearning,
  upsertRiskSignal,
  type Learning,
} from "./learning-store"
import { getUncoveredACs, getDefectsForModules, getGraphStats } from "../retrieval/graph-retrieval"

dotenv.config()

const DRY_RUN = process.argv.includes("--dry-run")
const MODULE_FILTER = (() => {
  const idx = process.argv.indexOf("--module")
  return idx !== -1 ? process.argv[idx + 1] : null
})()

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface ConsolidationResult {
  module_id: string
  patterns_found:   number
  signals_written:  number
  learnings_merged: number
}

// ─── Pattern extraction ───────────────────────────────────────────────────────

interface PatternCluster {
  pattern: string
  count:   number
  avg_confidence: number
  sources: string[]
}

function clusterPatterns(learnings: Learning[]): PatternCluster[] {
  // Normaliza patrones (lower, strip puntos) para agrupar similares
  const normalize = (s: string) => s.toLowerCase().replace(/[.!?]+$/, "").trim()

  const groups = new Map<string, Learning[]>()
  for (const l of learnings) {
    const key = normalize(l.pattern).slice(0, 80)
    const g = groups.get(key) ?? []
    g.push(l)
    groups.set(key, g)
  }

  return [...groups.entries()]
    .filter(([, ls]) => ls.length >= 2 || ls.some(l => l.confidence >= 0.9))
    .map(([key, ls]) => ({
      pattern:        key,
      count:          ls.length,
      avg_confidence: ls.reduce((s, l) => s + l.confidence, 0) / ls.length,
      sources:        [...new Set(ls.map(l => l.source))],
    }))
    .sort((a, b) => b.avg_confidence - a.avg_confidence || b.count - a.count)
}

// ─── Señales derivadas ────────────────────────────────────────────────────────

async function computeSignals(moduleId: string): Promise<Record<string, number>> {
  const signals: Record<string, number> = {}

  // Tasa de ACs sin cobertura
  const uncovered = await getUncoveredACs([moduleId], { priority: "MUST" })
  const allACs = await getUncoveredACs([moduleId])    // sin filtro
  const totalACs = allACs.length || 1
  signals["ac_gap_rate"] = Math.round((uncovered.length / totalACs) * 100) / 100

  // Densidad de defectos abiertos
  const openDefects = await getDefectsForModules([moduleId], { status: "open" })
  signals["open_defect_count"] = (openDefects ?? []).length

  // Velocidad de aprendizaje (learnings en últimos 30d)
  const recent = await getLearningsForModules([moduleId], { minConfidence: 0 })
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const recentCount = recent.filter(l => new Date(l.created_at) > thirtyDaysAgo).length
  signals["learning_velocity_30d"] = recentCount

  // Señales existentes — para detectar tendencias
  const existingSignals = await getRiskSignals(moduleId)
  const prevGapRate = existingSignals.find(s => s.signal === "ac_gap_rate")?.value ?? 0
  signals["ac_gap_trend"] = Math.round((signals["ac_gap_rate"] - prevGapRate) * 100) / 100

  return signals
}

// ─── Consolidación por módulo ─────────────────────────────────────────────────

async function consolidateModule(moduleId: string): Promise<ConsolidationResult> {
  console.log(`\n  [${moduleId}]`)

  const learnings = await getLearningsForModules([moduleId], { minConfidence: 0, limit: 100 })
  if (learnings.length === 0) {
    console.log("    No learnings — skip")
    return { module_id: moduleId, patterns_found: 0, signals_written: 0, learnings_merged: 0 }
  }

  // 1. Extraer patrones
  const clusters = clusterPatterns(learnings)
  console.log(`    Patrones: ${clusters.length} (de ${learnings.length} learnings)`)

  // 2. Escribir patrones consolidados como nuevos learnings con source="consolidator"
  let learningsMerged = 0
  if (!DRY_RUN) {
    for (const cluster of clusters.slice(0, 5)) {  // top 5 por módulo
      await writeLearning({
        feature:    moduleId,
        module_id:  moduleId,
        pattern:    cluster.pattern,
        context: {
          count:          cluster.count,
          avg_confidence: cluster.avg_confidence,
          sources:        cluster.sources,
          consolidated_at: new Date().toISOString(),
        },
        confidence: Math.min(cluster.avg_confidence * 1.1, 1.0),  // boost por repetición
        source: "consolidator",
      })
      learningsMerged++
    }
  } else {
    console.log(`    [DRY] Escribiría ${Math.min(clusters.length, 5)} learnings consolidados`)
    learningsMerged = Math.min(clusters.length, 5)
  }

  // 3. Calcular y escribir señales
  const signals = await computeSignals(moduleId)
  console.log(`    Señales: ${Object.entries(signals).map(([k, v]) => `${k}=${v}`).join(", ")}`)

  let signalsWritten = 0
  if (!DRY_RUN) {
    for (const [signal, value] of Object.entries(signals)) {
      await upsertRiskSignal(moduleId, signal, value)
      signalsWritten++
    }
  } else {
    console.log(`    [DRY] Escribiría ${Object.keys(signals).length} señales`)
    signalsWritten = Object.keys(signals).length
  }

  return {
    module_id:        moduleId,
    patterns_found:   clusters.length,
    signals_written:  signalsWritten,
    learnings_merged: learningsMerged,
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`\n${"═".repeat(55)}`)
  console.log(`  MEMORY CONSOLIDATION${DRY_RUN ? " (DRY RUN)" : ""}`)
  if (MODULE_FILTER) console.log(`  Módulo: ${MODULE_FILTER}`)
  console.log("═".repeat(55))

  // Obtener lista de módulos a consolidar
  let moduleIds: string[]

  if (MODULE_FILTER) {
    moduleIds = [MODULE_FILTER]
  } else {
    // Obtener todos los módulos que tienen learnings en DB
    const client = pgClient()
    try {
      await client.connect()
      const res = await client.query<{ module_id: string }>(
        `SELECT DISTINCT module_id FROM agent_learnings ORDER BY module_id`
      )
      moduleIds = res.rows.map(r => r.module_id)
    } catch {
      console.error("DB no disponible — abortando")
      process.exit(1)
    } finally {
      await client.end().catch(() => {})
    }
  }

  console.log(`\nMódulos a consolidar: ${moduleIds.length}`)

  const results: ConsolidationResult[] = []
  for (const mod of moduleIds) {
    results.push(await consolidateModule(mod))
  }

  // Stats del grafo para contexto
  const graphStats = await getGraphStats()
  if (Object.keys(graphStats).length > 0) {
    console.log(`\nGrafo Neo4j: ${JSON.stringify(graphStats)}`)
  }

  // Resumen
  const totalPatterns  = results.reduce((s, r) => s + r.patterns_found, 0)
  const totalSignals   = results.reduce((s, r) => s + r.signals_written, 0)
  const totalLearnings = results.reduce((s, r) => s + r.learnings_merged, 0)

  console.log(`\n${"─".repeat(55)}`)
  console.log(`  Módulos procesados: ${results.length}`)
  console.log(`  Patrones extraídos: ${totalPatterns}`)
  console.log(`  Señales escritas:   ${totalSignals}`)
  console.log(`  Learnings merged:   ${totalLearnings}`)
  console.log("═".repeat(55))
}

function pgClient(): PgClient {
  return new PgClient({
    host:     process.env.POSTGRES_HOST ?? "localhost",
    port:     Number(process.env.POSTGRES_PORT ?? 5432),
    database: process.env.POSTGRES_DB ?? "qa_platform",
    user:     process.env.POSTGRES_USER ?? "qa_user",
    password: process.env.POSTGRES_PASSWORD ?? "qa_password",
  })
}

main().catch(err => {
  console.error(`\nERROR: ${err.message}`)
  process.exit(1)
})
