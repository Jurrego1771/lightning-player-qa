/**
 * LangGraph Pipeline — Sprint 6
 *
 * Orquesta los 5 agentes con estado compartido, checkpoints y retry loop.
 *
 * Grafo:
 *   START → change-analysis → risk → dependency → test-selection → evaluator
 *                                                       ↑                ↓
 *                                          (REGENERATE, retry < 3) ←────┘
 *                                                       ↓ (PASS o retry agotado)
 *                                                      END
 *
 * Uso CLI: npx ts-node src/pipeline/langgraph-pipeline.ts '{"ref":"87","type":"pr"}'
 */

import * as fs from "fs"
import * as path from "path"
import { StateGraph, Annotation, START, END } from "@langchain/langgraph"
import { Client as PgClient } from "pg"
import * as dotenv from "dotenv"

import { runChangeAnalysis } from "../agents/change-analysis-agent"
import { runRiskAgent } from "../agents/risk-agent"
import { runDependencyAgent } from "../agents/dependency-agent"
import { runTestSelectionAgent } from "../agents/test-selection-agent"
import { runEvaluatorAgent } from "../agents/evaluator-agent"
import { runTestDesignAgent } from "../agents/test-design-agent"
import { startPipelineTrace } from "../observability/tracer"

import type {
  ChangeAnalysisOutput,
  RiskAgentOutput,
  DependencyAgentOutput,
  TestSelectionOutput,
  EvaluatorOutput,
  TestDesignOutput,
} from "../agents/types"

dotenv.config()

const MAX_RETRIES = 3

// ─── State schema ─────────────────────────────────────────────────────────────

const PipelineAnnotation = Annotation.Root({
  ref:              Annotation<string>({ reducer: (_, b) => b, default: () => "" }),
  ref_type:         Annotation<string>({ reducer: (_, b) => b, default: () => "pr" }),
  change_analysis:  Annotation<ChangeAnalysisOutput | undefined>({ reducer: (_, b) => b, default: () => undefined }),
  risks:            Annotation<RiskAgentOutput | undefined>({ reducer: (_, b) => b, default: () => undefined }),
  dependencies:     Annotation<DependencyAgentOutput | undefined>({ reducer: (_, b) => b, default: () => undefined }),
  selected_tests:   Annotation<TestSelectionOutput | undefined>({ reducer: (_, b) => b, default: () => undefined }),
  evaluation:       Annotation<EvaluatorOutput | undefined>({ reducer: (_, b) => b, default: () => undefined }),
  test_design:      Annotation<TestDesignOutput | undefined>({ reducer: (_, b) => b, default: () => undefined }),
  retry_count:      Annotation<number>({ reducer: (a, b) => b ?? a, default: () => 0 }),
  trace_id:         Annotation<string | undefined>({ reducer: (_, b) => b, default: () => undefined }),
  error:            Annotation<string | undefined>({ reducer: (_, b) => b, default: () => undefined }),
})

type PipelineState = typeof PipelineAnnotation.State

// ─── Nodos ────────────────────────────────────────────────────────────────────

async function changeAnalysisNode(state: PipelineState): Promise<Partial<PipelineState>> {
  console.error("[pipeline] → change-analysis")
  const result = await runChangeAnalysis({ ref: state.ref, type: state.ref_type as "pr" | "commit" | "branch" | "release" })
  return { change_analysis: result }
}

async function riskNode(state: PipelineState): Promise<Partial<PipelineState>> {
  console.error("[pipeline] → risk")
  const ca = state.change_analysis!
  const result = await runRiskAgent({
    features: ca.features,
    platforms: ca.platforms,
    services: ca.services,
    affected_modules: ca.affected_modules,
    change_summary: ca.change_summary,
    change_type: ca.change_type,
    cross_cutting: ca.cross_cutting,
  })
  return { risks: result }
}

async function dependencyNode(state: PipelineState): Promise<Partial<PipelineState>> {
  console.error("[pipeline] → dependency")
  const ca = state.change_analysis!
  const result = await runDependencyAgent({
    features: ca.features,
    affected_modules: ca.affected_modules,
  })
  return { dependencies: result }
}

async function testSelectionNode(state: PipelineState): Promise<Partial<PipelineState>> {
  const isRetry = state.retry_count > 0
  console.error(`[pipeline] → test-selection${isRetry ? ` (retry #${state.retry_count})` : ""}`)

  const ca = state.change_analysis!
  const result = await runTestSelectionAgent({
    features: ca.features,
    affected_modules: ca.affected_modules,
    risks: state.risks!.risks,
    dependencies: state.dependencies!.dependencies,
    // En retry: pasar feedback del evaluador para sesgar la selección
    evaluator_feedback: isRetry ? state.evaluation?.feedback : undefined,
    missing_criteria:   isRetry ? state.evaluation?.missing_criteria : undefined,
    missing_risks:      isRetry ? state.evaluation?.missing_risks : undefined,
  })
  return { selected_tests: result }
}

async function evaluatorNode(state: PipelineState): Promise<Partial<PipelineState>> {
  console.error("[pipeline] → evaluator")

  // Recopilar ACs requeridos desde los risks (todos los módulos afectados)
  const rootDir = path.join(__dirname, "..", "..")
  const allACIds = state.risks!.risks.flatMap(r => r.related_modules)
    .flatMap(mod => {
      try {
        const bPath = path.join(rootDir, "qa-knowledge", "modules", mod, "behavior.json")
        if (!fs.existsSync(bPath)) return []
        const b = JSON.parse(fs.readFileSync(bPath, "utf8")) as { acceptance_criteria?: Array<{ id: string; priority: string }> }
        return (b.acceptance_criteria ?? []).filter(ac => ac.priority === "MUST").map(ac => ac.id)
      } catch { return [] }
    })

  const result = await runEvaluatorAgent({
    selected_tests: state.selected_tests!.selected_tests,
    risks: state.risks!.risks,
    acceptance_criteria: [...new Set(allACIds)],
  })

  return {
    evaluation: result,
    retry_count: state.retry_count + (result.verdict === "REGENERATE" ? 1 : 0),
  }
}

async function testDesignNode(state: PipelineState): Promise<Partial<PipelineState>> {
  console.error("[pipeline] → test-design (gaps tras retries agotados)")
  const ev = state.evaluation!
  const ca = state.change_analysis!
  const result = await runTestDesignAgent({
    missing_criteria: ev.missing_criteria,
    missing_risks:    ev.missing_risks,
    features:         ca.features,
    affected_modules: ca.affected_modules,
  })
  return { test_design: result }
}

// ─── Router condicional ───────────────────────────────────────────────────────

function evaluatorRouter(state: PipelineState): "test-selection" | "test-design" | typeof END {
  if (state.evaluation?.verdict === "REGENERATE") {
    if (state.retry_count <= MAX_RETRIES) {
      console.error(`[pipeline] REGENERATE → retry #${state.retry_count}/${MAX_RETRIES}`)
      return "test-selection"
    }
    // Retries agotados con gaps — diseñar tests nuevos
    const hasMissingItems =
      (state.evaluation.missing_criteria.length > 0) ||
      (state.evaluation.missing_risks.length > 0)
    if (hasMissingItems) {
      console.error("[pipeline] REGENERATE + retries agotados → test-design")
      return "test-design"
    }
  }
  const finalVerdict = state.evaluation?.verdict ?? "UNKNOWN"
  console.error(`[pipeline] → END (verdict: ${finalVerdict})`)
  return END
}

// ─── Grafo ────────────────────────────────────────────────────────────────────

function buildGraph() {
  return new StateGraph(PipelineAnnotation)
    .addNode("change-analysis", changeAnalysisNode)
    .addNode("risk", riskNode)
    .addNode("dependency", dependencyNode)
    .addNode("test-selection", testSelectionNode)
    .addNode("evaluator", evaluatorNode)
    .addNode("test-design", testDesignNode)
    .addEdge(START, "change-analysis")
    .addEdge("change-analysis", "risk")
    .addEdge("risk", "dependency")
    .addEdge("dependency", "test-selection")
    .addEdge("test-selection", "evaluator")
    .addEdge("test-design", END)
    .addConditionalEdges("evaluator", evaluatorRouter, {
      "test-selection": "test-selection",
      "test-design":    "test-design",
      [END]: END,
    })
    .compile()
}

// ─── Persistencia en PostgreSQL ───────────────────────────────────────────────

async function persistRun(state: PipelineState, traceId: string | undefined): Promise<void> {
  const client = new PgClient({
    host: process.env.POSTGRES_HOST ?? "localhost",
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    database: process.env.POSTGRES_DB ?? "qa_platform",
    user: process.env.POSTGRES_USER ?? "qa_user",
    password: process.env.POSTGRES_PASSWORD ?? "qa_password",
  })
  try {
    await client.connect()
    await client.query(
      `INSERT INTO pipeline_runs
         (ref, ref_type, change_analysis, risks, dependencies, selected_tests, evaluation, verdict, langfuse_trace_id, finished_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`,
      [
        state.ref,
        state.ref_type,
        JSON.stringify(state.change_analysis ?? null),
        JSON.stringify(state.risks ?? null),
        JSON.stringify(state.dependencies ?? null),
        JSON.stringify({ ...(state.selected_tests ?? {}), test_design: state.test_design ?? null }),
        JSON.stringify(state.evaluation ?? null),
        state.evaluation?.verdict ?? "UNKNOWN",
        traceId ?? null,
      ]
    )
  } catch { /* DB no disponible — continuar */ } finally {
    await client.end().catch(() => {})
  }
}

// ─── Punto de entrada ─────────────────────────────────────────────────────────

export async function runPipeline(ref: string, refType: string): Promise<PipelineState> {
  const tracer = startPipelineTrace(ref, refType)

  const graph = buildGraph()

  const initialState: Partial<PipelineState> = {
    ref,
    ref_type: refType,
    retry_count: 0,
    trace_id: tracer.traceId,
  }

  console.error(`\n${"═".repeat(60)}`)
  console.error(`  QA PIPELINE — ${ref} (${refType})`)
  console.error(`  Trace: ${tracer.traceId}`)
  console.error("═".repeat(60))

  const finalState = await graph.invoke(initialState) as PipelineState

  await persistRun(finalState, tracer.traceId)
  await tracer.end()

  return finalState
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const raw = process.argv[2]
  if (!raw) {
    console.error("Uso: npx ts-node src/pipeline/langgraph-pipeline.ts '{\"ref\":\"87\",\"type\":\"pr\"}'")
    process.exit(1)
  }

  let ref: string
  let refType: string

  try {
    const parsed = JSON.parse(raw) as { ref: string; type: string }
    ref = parsed.ref
    refType = parsed.type
  } catch {
    const [r, t] = raw.split(" ")
    ref = r
    refType = t ?? "pr"
  }

  runPipeline(ref, refType)
    .then(state => {
      console.error("\n" + "═".repeat(60))
      console.error(`  PIPELINE COMPLETADO`)
      console.error(`  Verdict:      ${state.evaluation?.verdict ?? "UNKNOWN"}`)
      console.error(`  Coverage:     ${state.evaluation?.coverage ?? 0}%`)
      console.error(`  Hallucination:${state.evaluation?.hallucination_score ?? 0}`)
      console.error(`  Retries:      ${state.retry_count}`)
      console.error(`  Tests sel.:   ${state.selected_tests?.selected_tests.length ?? 0}`)
      console.error("═".repeat(60))
      console.log(JSON.stringify({
        verdict:           state.evaluation?.verdict,
        coverage:          state.evaluation?.coverage,
        selected_tests:    state.selected_tests?.selected_tests.length,
        risks:             state.risks?.risks.length,
        trace_id:          state.trace_id,
        retry_count:       state.retry_count,
        test_design: state.test_design ? {
          scenarios:         state.test_design.scenarios.length,
          specs_written:     state.test_design.spec_drafts.filter(d => d.written).length,
          covered_criteria:  state.test_design.covered_criteria.length,
          still_missing:     state.test_design.still_missing.length,
        } : null,
      }, null, 2))
    })
    .catch(err => {
      console.error(`\nPIPELINE ERROR: ${err.message}`)
      console.error(err.stack)
      process.exit(1)
    })
}
