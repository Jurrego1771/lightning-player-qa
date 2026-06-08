/**
 * Evaluator Agent — Sprint 5
 *
 * Input:  {selected_tests, risks, acceptance_criteria[]}
 * Output: {coverage, missing_criteria, hallucination_score, traceability_score, verdict}
 *
 * Mayormente DETERMINISTA — verifica hechos, no razona.
 * Sin LLM para los checks principales. LLM solo para generar feedback legible.
 *
 * Checks:
 *   1. spec_file existe en disco → evidence_found
 *   2. covers_acs claim verificado contra behavior.json → traceability
 *   3. covers_risks válidos contra risks input → no hallucinated risk IDs
 *   4. coverage = risks cubiertos / total risks
 *   5. hallucination_score = claims falsos / total claims
 *
 * Umbrales:
 *   PASS si coverage >= 85 AND hallucination_score < 0.10
 *   REGENERATE si no
 *
 * Uso CLI: npx ts-node src/agents/evaluator-agent.ts '<EvaluatorInput JSON>'
 */

import * as fs from "fs"
import * as path from "path"
import { Client as PgClient } from "pg"
import * as dotenv from "dotenv"

import type { EvaluatorInput, EvaluatorOutput, ScenarioAudit, SelectedTest } from "./types"
import { startAgentTrace } from "../observability/tracer"
import { callClaudeJson } from "../llm/claude-cli"

dotenv.config()

const ROOT = path.join(__dirname, "..", "..")
const MODULES_DIR = path.join(ROOT, "qa-knowledge", "modules")

const COVERAGE_THRESHOLD = 85
const HALLUCINATION_THRESHOLD = 0.10

// ─── AC index desde behavior.json ────────────────────────────────────────────

interface ACRecord {
  module: string
  scenario: string
  covered_by: string[]
}

function buildACIndex(): Map<string, ACRecord> {
  const idx = new Map<string, ACRecord>()
  if (!fs.existsSync(MODULES_DIR)) return idx

  for (const modName of fs.readdirSync(MODULES_DIR)) {
    const bPath = path.join(MODULES_DIR, modName, "behavior.json")
    if (!fs.existsSync(bPath)) continue
    try {
      const behavior = JSON.parse(fs.readFileSync(bPath, "utf8")) as {
        acceptance_criteria?: Array<{ id: string; scenario: string; covered_by?: string[] }>
      }
      for (const ac of behavior.acceptance_criteria ?? []) {
        idx.set(ac.id, {
          module: modName,
          scenario: ac.scenario,
          covered_by: ac.covered_by ?? [],
        })
      }
    } catch { /* ignore */ }
  }
  return idx
}

// Fallback: cargar ACs desde PostgreSQL si DB disponible
async function loadACsFromDB(acIds: string[]): Promise<Map<string, { scenario: string; covered_by: string[] }>> {
  const idx = new Map<string, { scenario: string; covered_by: string[] }>()
  if (acIds.length === 0) return idx

  const client = new PgClient({
    host: process.env.POSTGRES_HOST ?? "localhost",
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    database: process.env.POSTGRES_DB ?? "qa_platform",
    user: process.env.POSTGRES_USER ?? "qa_user",
    password: process.env.POSTGRES_PASSWORD ?? "qa_password",
  })
  try {
    await client.connect()
    const res = await client.query<{ id: string; scenario: string; covered_by: string[] }>(
      `SELECT id, scenario, covered_by FROM acceptance_criteria WHERE id = ANY($1)`,
      [acIds]
    )
    for (const row of res.rows) {
      idx.set(row.id, { scenario: row.scenario, covered_by: row.covered_by ?? [] })
    }
  } catch { /* DB no disponible → usar behavior.json */ } finally {
    await client.end().catch(() => {})
  }
  return idx
}

// ─── Verificación de un test ──────────────────────────────────────────────────

interface TestVerification {
  spec_file: string
  file_exists: boolean
  valid_ac_claims: string[]    // ACs que existen en el índice
  invalid_ac_claims: string[]  // ACs reclamados pero no existen
  verified_ac_links: string[]  // ACs donde covered_by del behavior.json menciona este spec
  valid_risk_claims: string[]
  invalid_risk_claims: string[]
}

function verifyTest(
  test: SelectedTest,
  acIdx: Map<string, ACRecord>,
  validRiskIds: Set<string>
): TestVerification {
  const fullPath = path.join(ROOT, test.spec_file)
  const fileExists = fs.existsSync(fullPath)

  // Verificar AC claims
  const validACs: string[] = []
  const invalidACs: string[] = []
  const verifiedLinks: string[] = []

  for (const acId of test.covers_acs) {
    const acRecord = acIdx.get(acId)
    if (!acRecord) {
      invalidACs.push(acId)
      continue
    }
    validACs.push(acId)
    // ¿El behavior.json del AC menciona este spec en covered_by?
    const specBase = path.basename(test.spec_file)
    if (acRecord.covered_by.some(cb => cb.includes(specBase) || test.spec_file.includes(cb))) {
      verifiedLinks.push(acId)
    }
  }

  // Verificar risk claims
  const validRisks: string[] = []
  const invalidRisks: string[] = []
  for (const rId of test.covers_risks) {
    if (validRiskIds.has(rId)) validRisks.push(rId)
    else invalidRisks.push(rId)
  }

  return {
    spec_file: test.spec_file,
    file_exists: fileExists,
    valid_ac_claims: validACs,
    invalid_ac_claims: invalidACs,
    verified_ac_links: verifiedLinks,
    valid_risk_claims: validRisks,
    invalid_risk_claims: invalidRisks,
  }
}

function classifyTraceability(v: TestVerification): ScenarioAudit["traceability"] {
  if (!v.file_exists) return "missing"
  if (v.invalid_ac_claims.length > 0 || v.invalid_risk_claims.length > 0) return "missing"
  if (v.verified_ac_links.length > 0 || v.valid_ac_claims.length === 0) return "verified"
  return "claimed"  // AC existe pero no hay link en covered_by
}

// ─── Feedback con LLM (solo si REGENERATE) ───────────────────────────────────

async function generateFeedback(
  missingCriteria: string[],
  missingRisks: string[],
  hallucinations: string[],
  acIdx: Map<string, ACRecord>
): Promise<string[]> {
  if (missingCriteria.length === 0 && missingRisks.length === 0) return []

  const missingACDetails = missingCriteria.slice(0, 5).map(id => {
    const ac = acIdx.get(id)
    return ac ? `${id}: "${ac.scenario}" (módulo: ${ac.module})` : id
  })

  const prompt = `Eres un evaluador QA. La selección de tests falló por cobertura insuficiente.

ACs sin cobertura: ${missingACDetails.join("; ")}
Riesgos sin tests: ${missingRisks.slice(0, 5).join(", ")}
Hallucinations detectados: ${hallucinations.slice(0, 3).join(", ")}

Genera máximo 4 mensajes de feedback CONCISOS para que el Test Selection Agent corrija la selección.
Cada mensaje debe ser ≤ 80 chars, específico y accionable.

Responde SOLO con JSON: {"feedback": ["msg1", "msg2"]}`

  try {
    const parsed = await callClaudeJson<{ feedback: string[] }>(prompt, { model: "haiku" })
    return parsed.feedback ?? []
  } catch { /* fallback */ }

  // Fallback determinista
  const fb: string[] = []
  if (missingCriteria.length > 0) fb.push(`Agregar tests para: ${missingCriteria.slice(0, 3).join(", ")}`)
  if (missingRisks.length > 0) fb.push(`Sin cobertura para riesgos: ${missingRisks.slice(0, 3).join(", ")}`)
  if (hallucinations.length > 0) fb.push(`Hallucinations: ${hallucinations.slice(0, 2).join(", ")} no existen en disco`)
  return fb
}

// ─── Guardar aprendizajes en DB ───────────────────────────────────────────────

async function persistLearnings(
  missingCriteria: string[],
  acIdx: Map<string, ACRecord>
): Promise<void> {
  if (missingCriteria.length === 0) return

  const client = new PgClient({
    host: process.env.POSTGRES_HOST ?? "localhost",
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    database: process.env.POSTGRES_DB ?? "qa_platform",
    user: process.env.POSTGRES_USER ?? "qa_user",
    password: process.env.POSTGRES_PASSWORD ?? "qa_password",
  })
  try {
    await client.connect()
    for (const acId of missingCriteria.slice(0, 5)) {
      const ac = acIdx.get(acId)
      if (!ac) continue
      await client.query(
        `INSERT INTO agent_learnings (feature, module_id, pattern, context, confidence, source)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          ac.module,
          ac.module,
          `AC sin cobertura detectada: "${ac.scenario}"`,
          JSON.stringify({ ac_id: acId, module: ac.module, scenario: ac.scenario }),
          0.9,
          "evaluator",
        ]
      )
    }
  } catch { /* DB no disponible */ } finally {
    await client.end().catch(() => {})
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function runEvaluatorAgent(input: EvaluatorInput): Promise<EvaluatorOutput> {
  const span = startAgentTrace("evaluator-agent", {
    tests_count: input.selected_tests.length,
    risks_count: input.risks.length,
    ac_count: input.acceptance_criteria.length,
  })

  try {
    // Construir índices
    const acIdx = buildACIndex()

    // Enriquecer con DB si está disponible
    const allAcIds = [...new Set(input.selected_tests.flatMap(t => t.covers_acs))]
    const dbACs = await loadACsFromDB(allAcIds)
    for (const [id, record] of dbACs) {
      if (!acIdx.has(id)) {
        acIdx.set(id, { module: "", scenario: record.scenario, covered_by: record.covered_by })
      }
    }

    const validRiskIds = new Set(input.risks.map(r => r.id))

    // Verificar cada test
    const verifications = input.selected_tests.map(t => verifyTest(t, acIdx, validRiskIds))

    // Construir auditoría por escenario
    const scenariosAudit: ScenarioAudit[] = verifications.map(v => ({
      test_id: v.spec_file,
      covers_ac: v.valid_ac_claims,
      evidence_found: v.file_exists,
      traceability: classifyTraceability(v),
    }))

    // Calcular hallucination_score
    let totalClaims = 0
    let falseClaims = 0
    for (const v of verifications) {
      // Claim de existencia de archivo
      totalClaims++
      if (!v.file_exists) falseClaims++
      // Claims de AC
      totalClaims += v.valid_ac_claims.length + v.invalid_ac_claims.length
      falseClaims += v.invalid_ac_claims.length
      // Claims de riesgo
      totalClaims += v.valid_risk_claims.length + v.invalid_risk_claims.length
      falseClaims += v.invalid_risk_claims.length
    }
    const hallucinationScore = totalClaims > 0 ? falseClaims / totalClaims : 0

    // Calcular traceability_score
    const verified = scenariosAudit.filter(s => s.traceability === "verified").length
    const traceabilityScore = scenariosAudit.length > 0 ? verified / scenariosAudit.length : 1

    // Coverage: % de risks del input cubiertos por al menos 1 test seleccionado
    const coveredRiskIds = new Set(
      input.selected_tests.flatMap(t => t.covers_risks).filter(r => validRiskIds.has(r))
    )
    const coverage = input.risks.length > 0
      ? Math.round((coveredRiskIds.size / input.risks.length) * 100)
      : 100

    // ACs faltantes: los del input que no aparecen en ningún covers_acs
    const coveredACIds = new Set(input.selected_tests.flatMap(t => t.covers_acs))
    const missingCriteria = input.acceptance_criteria.filter(id => !coveredACIds.has(id))

    // Risks faltantes
    const missingRisks = input.risks
      .filter(r => !coveredRiskIds.has(r.id))
      .map(r => r.id)

    // Hallucinations: archivos que no existen
    const hallucinations = verifications
      .filter(v => !v.file_exists)
      .map(v => v.spec_file)

    // Determinar veredicto
    const passes =
      coverage >= COVERAGE_THRESHOLD &&
      hallucinationScore < HALLUCINATION_THRESHOLD

    const verdict: EvaluatorOutput["verdict"] = passes ? "PASS" : "REGENERATE"

    // Feedback solo si REGENERATE
    const feedback = verdict === "REGENERATE"
      ? await generateFeedback(missingCriteria, missingRisks, hallucinations, acIdx)
      : []

    // Persistir aprendizajes si REGENERATE
    if (verdict === "REGENERATE" && missingCriteria.length > 0) {
      await persistLearnings(missingCriteria, acIdx)
    }

    const output: EvaluatorOutput = {
      coverage,
      missing_criteria: missingCriteria,
      missing_risks: missingRisks,
      hallucination_score: Math.round(hallucinationScore * 100) / 100,
      traceability_score: Math.round(traceabilityScore * 100) / 100,
      scenarios_audit: scenariosAudit,
      verdict,
      feedback,
    }

    span.end(output, { verdict, coverage, hallucination_score: hallucinationScore })
    return output

  } catch (err) {
    span.error(err as Error)
    throw err
  }
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const raw = process.argv[2]
  if (!raw) {
    console.error("Uso: npx ts-node src/agents/evaluator-agent.ts '<EvaluatorInput JSON>'")
    process.exit(1)
  }

  const input = JSON.parse(raw) as EvaluatorInput

  runEvaluatorAgent(input)
    .then(output => {
      const icon = output.verdict === "PASS" ? "✓" : "✗"
      console.error(`\n${icon} Verdict: ${output.verdict} | Coverage: ${output.coverage}% | Hallucination: ${output.hallucination_score} | Traceability: ${output.traceability_score}`)
      if (output.feedback.length > 0) {
        console.error("  Feedback:")
        output.feedback.forEach(f => console.error(`    - ${f}`))
      }
      console.log(JSON.stringify(output, null, 2))
    })
    .catch(err => {
      console.error(JSON.stringify({ error: err.message }))
      process.exit(1)
    })
}
