// Contratos JSON estrictos de todos los agentes.
// Todo I/O de agentes es JSON. Nunca texto libre.

// ─── Change Analysis Agent ───────────────────────────────────────────────────

export interface ChangeAnalysisInput {
  ref: string   // PR number | commit SHA | branch | "release/v1.2"
  type: "pr" | "commit" | "branch" | "release"
}

export interface PrMetadata {
  title: string
  body: string
  head_branch: string
  base_branch: string
  labels: string[]
  author: string
  reviewer_comments?: string[]
}

export interface SemanticSignals {
  reviewer_signals: string[]
  unknown_files_classified: number
  change_type_overridden: boolean
}

export interface ChangeAnalysisOutput {
  ref: string
  ref_type: string
  features: string[]          // módulos/features de negocio afectados
  platforms: string[]         // ["web", "android", "ios", "tv"]
  services: string[]          // servicios externos tocados ["google-ima", "youbora", "hls.js"]
  affected_modules: string[]  // módulos internos (de risk_map.yaml)
  change_summary: string      // título del PR o descripción generada
  risk_signal: "high" | "medium" | "low"
  change_type: string         // feature | bug-fix | refactor | docs | test-update | ...
  cross_cutting: boolean
  similar_past_changes: SimilarChange[]
  pr_metadata?: PrMetadata    // solo cuando input_type=pr
  llm_used: boolean
  llm_model?: string
  llm_trigger_reasons?: string[]
  semantic_signals?: SemanticSignals
}

export interface SimilarChange {
  chunk_id: string
  module: string
  text: string
  score: number
}

// ─── Risk Agent ──────────────────────────────────────────────────────────────

export interface RiskAgentInput {
  features: string[]
  platforms: string[]
  services: string[]
  affected_modules: string[]
  change_summary: string
  change_type: string
  cross_cutting: boolean
}

export interface Risk {
  id: string
  description: string
  severity: "critical" | "high" | "medium" | "low"
  category: "functional" | "security" | "performance" | "integration"
  related_modules: string[]
  historical_bugs: string[]
  evidence: string
}

export interface RiskAgentOutput {
  risks: Risk[]
}

// ─── Dependency Agent ────────────────────────────────────────────────────────

export interface DependencyAgentInput {
  features: string[]
  affected_modules: string[]
}

export interface Dependency {
  module: string
  type: "internal" | "external"
  criticality: "critical" | "high" | "medium" | "low"
  source: "context_yaml" | "git_analysis" | "both"
  breaks_if_changed: string[]
}

export interface DependencyAgentOutput {
  dependencies: Dependency[]
}

// ─── Test Selection Agent ────────────────────────────────────────────────────

export interface TestSelectionInput {
  features: string[]
  affected_modules: string[]
  risks: Risk[]
  dependencies: Dependency[]
  time_budget_minutes?: number
  evaluator_feedback?: string[]   // populated on retry — from EvaluatorOutput.feedback
  missing_criteria?: string[]     // populated on retry — ACs aún sin cobertura
  missing_risks?: string[]        // populated on retry — risk IDs aún sin tests
}

export interface SelectedTest {
  spec_file: string
  test_name: string
  priority: number          // 1-100
  reason: string
  covers_risks: string[]
  covers_acs: string[]
  estimated_duration_ms: number
}

export interface TestSelectionOutput {
  selected_tests: SelectedTest[]
  coverage_estimate: number
  excluded_count: number
  total_duration_ms: number
}

// ─── Evaluator Agent ─────────────────────────────────────────────────────────

export interface EvaluatorInput {
  selected_tests: SelectedTest[]
  risks: Risk[]
  acceptance_criteria: string[]
}

export interface ScenarioAudit {
  test_id: string
  covers_ac: string[]
  evidence_found: boolean
  traceability: "verified" | "claimed" | "missing"
}

export interface EvaluatorOutput {
  coverage: number
  missing_criteria: string[]
  missing_risks: string[]
  hallucination_score: number     // 0-1 (0 = sin hallucinations)
  traceability_score: number      // 0-1
  scenarios_audit: ScenarioAudit[]
  verdict: "PASS" | "REGENERATE"
  feedback: string[]
}

// ─── Test Design Agent ───────────────────────────────────────────────────────

export interface TestDesignInput {
  missing_criteria: string[]      // AC IDs sin cobertura (del Evaluador)
  missing_risks: string[]         // risk IDs sin tests (del Evaluador)
  features: string[]
  affected_modules: string[]
}

export interface TestScenario {
  id: string                      // "TS-{module}-{n}"
  module: string
  type: "functional" | "negative" | "boundary" | "integration" | "regression"
  priority: "MUST" | "SHOULD" | "COULD"
  title: string
  given: string
  when: string
  then: string
  covers_ac: string[]
  covers_risks: string[]
  suggested_spec_file: string     // ruta relativa sugerida
}

export interface SpecDraft {
  spec_file: string               // ruta relativa donde se escribió
  module: string
  scenarios_count: number
  code: string                    // código Playwright TypeScript completo
  written: boolean                // si se escribió a disco
  validation_passed: boolean
  validation_error?: string
}

export interface TestDesignOutput {
  scenarios: TestScenario[]
  spec_drafts: SpecDraft[]
  covered_criteria: string[]
  covered_risks: string[]
  still_missing: string[]         // ACs/risks que no se pudieron cubrir
}

// ─── Pipeline State (LangGraph) ──────────────────────────────────────────────

export interface PipelineState {
  ref: string
  ref_type: string
  change_analysis?: ChangeAnalysisOutput
  risks?: RiskAgentOutput
  dependencies?: DependencyAgentOutput
  selected_tests?: TestSelectionOutput
  evaluation?: EvaluatorOutput
  test_design?: TestDesignOutput
  retry_count: number
  trace_id?: string
  error?: string
}
