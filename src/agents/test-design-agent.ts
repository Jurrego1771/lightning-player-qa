/**
 * Test Design Agent — Sprint 7
 *
 * Input:  {missing_criteria, missing_risks, features, affected_modules}
 * Output: {scenarios[], spec_drafts[], covered_criteria, covered_risks, still_missing}
 *
 * Corre cuando Evaluador agota retries y aún hay gaps.
 * Dos fases:
 *   1. DETERMINISTA — enriquecer AC IDs con datos reales de behavior.json
 *   2. LLM (Sonnet) — diseñar escenarios BDD + generar código Playwright
 *
 * Convenciones obligatorias (de test-generator.md):
 *   - import desde 'fixtures/', nunca @playwright/test
 *   - waitForEvent / expect.poll — nunca waitForTimeout
 *   - Selectores aria/data-testid, nunca clases CSS internas
 *
 * Uso CLI: npx ts-node src/agents/test-design-agent.ts '<TestDesignInput JSON>'
 */

import * as fs from "fs"
import * as path from "path"
import { execSync } from "child_process"
import * as dotenv from "dotenv"

import type { TestDesignInput, TestDesignOutput, TestScenario, SpecDraft } from "./types"
import { startAgentTrace } from "../observability/tracer"
import { callClaudeJson } from "../llm/claude-cli"

dotenv.config()

const ROOT = path.join(__dirname, "..", "..")
const MODULES_DIR = path.join(ROOT, "qa-knowledge", "modules")
const TESTS_DIR = path.join(ROOT, "tests")

// ─── Tipos internos ───────────────────────────────────────────────────────────

interface ACRecord {
  id: string
  module: string
  scenario: string
  priority: string
  given?: string
  when_clause?: string
  then?: string
  covered_by: string[]
  known_bug?: string
}

interface BehaviorJson {
  module?: string
  acceptance_criteria?: Array<{
    id: string
    scenario: string
    priority?: string
    given?: string
    when?: string
    then?: string
    covered_by?: string[]
    known_bug?: string
  }>
  events?: Array<{ name: string; when: string }>
  test_anti_patterns?: string[]
  known_bugs?: Array<{ id: string; description: string; status: string }>
}

// ─── Carga de contexto ────────────────────────────────────────────────────────

function loadBehavior(modName: string): BehaviorJson | null {
  const p = path.join(MODULES_DIR, modName, "behavior.json")
  if (!fs.existsSync(p)) return null
  try { return JSON.parse(fs.readFileSync(p, "utf8")) as BehaviorJson } catch { return null }
}

function resolveACsFromBehavior(acIds: string[]): ACRecord[] {
  const allModules = fs.existsSync(MODULES_DIR)
    ? fs.readdirSync(MODULES_DIR)
    : []

  const idx = new Map<string, ACRecord>()
  for (const mod of allModules) {
    const b = loadBehavior(mod)
    for (const ac of b?.acceptance_criteria ?? []) {
      idx.set(ac.id, {
        id: ac.id,
        module: mod,
        scenario: ac.scenario,
        priority: ac.priority ?? "SHOULD",
        given: ac.given,
        when_clause: ac.when,
        then: ac.then,
        covered_by: ac.covered_by ?? [],
        known_bug: ac.known_bug,
      })
    }
  }

  return acIds.map(id => idx.get(id)).filter(Boolean) as ACRecord[]
}

// ─── Spec de referencia ───────────────────────────────────────────────────────

function loadReferenceSpec(type: "integration" | "e2e" | "contract"): string {
  const dir = path.join(TESTS_DIR, type)
  if (!fs.existsSync(dir)) return ""
  const specs = fs.readdirSync(dir).filter(f => f.endsWith(".spec.ts"))
  if (!specs.length) return ""
  try {
    const content = fs.readFileSync(path.join(dir, specs[0]), "utf8")
    return content.slice(0, 3000)  // primeros 3k chars como referencia de estilo
  } catch { return "" }
}

// ─── Agrupación por módulo ────────────────────────────────────────────────────

interface ModuleGroup {
  module: string
  acs: ACRecord[]
  antiPatterns: string[]
  knownBugs: Array<{ id: string; description: string }>
  events: Array<{ name: string; when: string }>
}

function groupByModule(acs: ACRecord[], affectedModules: string[]): ModuleGroup[] {
  const groups = new Map<string, ModuleGroup>()

  for (const ac of acs) {
    if (!groups.has(ac.module)) {
      const b = loadBehavior(ac.module) ?? {}
      groups.set(ac.module, {
        module: ac.module,
        acs: [],
        antiPatterns: b.test_anti_patterns ?? [],
        knownBugs: (b.known_bugs ?? []).filter(kb => kb.status === "open").map(kb => ({ id: kb.id, description: kb.description })),
        events: b.events ?? [],
      })
    }
    groups.get(ac.module)!.acs.push(ac)
  }

  // Incluir módulos afectados sin ACs si tienen behavior.json con eventos relevantes
  for (const mod of affectedModules) {
    if (!groups.has(mod)) {
      const b = loadBehavior(mod)
      if (b?.events?.length) {
        groups.set(mod, {
          module: mod,
          acs: [],
          antiPatterns: b.test_anti_patterns ?? [],
          knownBugs: [],
          events: b.events,
        })
      }
    }
  }

  return [...groups.values()]
}

// ─── LLM: diseño de escenarios + código Playwright ───────────────────────────

interface LLMResponse {
  scenarios: TestScenario[]
  playwright_code: string
}

async function designWithLLM(
  group: ModuleGroup,
  missingRisks: string[],
  referenceSpec: string,
  specFile: string
): Promise<LLMResponse> {
  const acsBlock = group.acs.map(ac => {
    const lines = [`  ID: ${ac.id}`, `  Scenario: ${ac.scenario}`]
    if (ac.given) lines.push(`  Given: ${ac.given}`)
    if (ac.when_clause) lines.push(`  When: ${ac.when_clause}`)
    if (ac.then) lines.push(`  Then: ${ac.then}`)
    if (ac.known_bug) lines.push(`  ⚠ Known bug: ${ac.known_bug} (usar test.skip)`)
    return lines.join("\n")
  }).join("\n\n")

  const prompt = `Eres un experto en QA de video players. Diseña tests de Playwright para el módulo "${group.module}".

## ACs sin cobertura (MUST cubrir):
${acsBlock || "(ninguno — diseñar tests para riesgos)"}

## Riesgos sin tests:
${missingRisks.slice(0, 5).join(", ") || "(ninguno)"}

## Anti-patrones PROHIBIDOS para este módulo:
${group.antiPatterns.join("\n") || "(ninguno adicional)"}

## Bugs conocidos abiertos (usar test.skip si aplica):
${group.knownBugs.map(b => `${b.id}: ${b.description}`).join("\n") || "(ninguno)"}

## Eventos del módulo (para lifecycle tests):
${group.events.map(e => `${e.name}: ${e.when}`).join("\n") || "(ninguno)"}

## Spec de referencia (seguir este estilo exacto):
\`\`\`typescript
${referenceSpec || "// No hay referencia disponible"}
\`\`\`

## REGLAS OBLIGATORIAS:
1. import { test, expect } from '../../fixtures' — NUNCA @playwright/test
2. import { MockContentIds, ContentIds } desde '../../fixtures'
3. Usar isolatedPlayer.waitForEvent('event', 15_000) — NUNCA waitForTimeout
4. Usar expect.poll() para aserciones asíncronas — NUNCA setTimeout
5. Selectores: [aria-label="..."] o [data-testid="..."] — NUNCA .msp-* ni .MediastreamPlayer
6. Si el AC tiene known_bug → usar test.skip("reason — bugId")
7. page.route() SIEMPRE antes de isolatedPlayer.goto()

## Archivo de destino: ${specFile}

Responde SOLO con JSON válido:
{
  "scenarios": [
    {
      "id": "TS-${group.module}-001",
      "module": "${group.module}",
      "type": "integration",
      "priority": "MUST",
      "title": "descripción breve del test",
      "given": "estado inicial",
      "when": "acción",
      "then": "resultado esperado",
      "covers_ac": ["AC-ID-001"],
      "covers_risks": [],
      "suggested_spec_file": "${specFile}"
    }
  ],
  "playwright_code": "// código TypeScript completo aquí"
}`

  return await callClaudeJson<LLMResponse>(prompt, { model: "sonnet", timeoutMs: 300_000 })
}

// ─── Validación con playwright --list ─────────────────────────────────────────

function validateSpec(specFile: string): { passed: boolean; error?: string } {
  const absPath = path.join(ROOT, specFile)
  if (!fs.existsSync(absPath)) return { passed: false, error: "Archivo no encontrado en disco" }
  try {
    execSync(`npx playwright test "${absPath}" --list 2>&1`, {
      cwd: ROOT,
      timeout: 30_000,
      stdio: "pipe",
    })
    return { passed: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const lines = msg.split("\n").filter(l => l.includes("error") || l.includes("Error")).slice(0, 3)
    return { passed: false, error: lines.join(" | ") || msg.slice(0, 200) }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function runTestDesignAgent(input: TestDesignInput): Promise<TestDesignOutput> {
  const span = startAgentTrace("test-design-agent", {
    missing_criteria: input.missing_criteria.length,
    missing_risks: input.missing_risks.length,
  })

  try {
    // Sin gaps → nada que hacer
    if (input.missing_criteria.length === 0 && input.missing_risks.length === 0) {
      const empty: TestDesignOutput = {
        scenarios: [],
        spec_drafts: [],
        covered_criteria: [],
        covered_risks: [],
        still_missing: [],
      }
      span.end(empty, { skipped: true })
      return empty
    }

    // Enriquecer AC IDs con datos completos desde behavior.json
    const resolvedACs = resolveACsFromBehavior(input.missing_criteria)
    const unresolvedACs = input.missing_criteria.filter(
      id => !resolvedACs.find(ac => ac.id === id)
    )

    // Agrupar por módulo
    const groups = groupByModule(resolvedACs, input.affected_modules)

    // Si no hay grupos pero hay riesgos, crear grupo genérico por módulo afectado
    if (groups.length === 0 && input.missing_risks.length > 0) {
      for (const mod of input.affected_modules.slice(0, 3)) {
        const b = loadBehavior(mod)
        if (b) groups.push({
          module: mod,
          acs: [],
          antiPatterns: b.test_anti_patterns ?? [],
          knownBugs: [],
          events: b.events ?? [],
        })
      }
    }

    const referenceSpec = loadReferenceSpec("integration")
    const allScenarios: TestScenario[] = []
    const specDrafts: SpecDraft[] = []
    const coveredCriteria = new Set<string>()
    const coveredRisks = new Set<string>()

    for (const group of groups) {
      const specFile = `tests/integration/${group.module}-generated.spec.ts`
      const absPath = path.join(ROOT, specFile)

      // Evitar sobreescribir si ya existe y tiene contenido
      if (fs.existsSync(absPath) && fs.statSync(absPath).size > 200) {
        console.error(`[test-design] skip ${specFile} — ya existe`)
        group.acs.forEach(ac => coveredCriteria.add(ac.id))
        continue
      }

      let llmResult: LLMResponse
      try {
        llmResult = await designWithLLM(group, input.missing_risks, referenceSpec, specFile)
      } catch (err) {
        console.error(`[test-design] LLM error para ${group.module}: ${(err as Error).message}`)
        specDrafts.push({
          spec_file: specFile,
          module: group.module,
          scenarios_count: 0,
          code: "",
          written: false,
          validation_passed: false,
          validation_error: (err as Error).message,
        })
        continue
      }

      // Registrar escenarios
      allScenarios.push(...(llmResult.scenarios ?? []))

      // Marcar como cubiertos
      for (const s of llmResult.scenarios ?? []) {
        s.covers_ac.forEach(id => coveredCriteria.add(id))
        s.covers_risks.forEach(id => coveredRisks.add(id))
      }

      // Escribir spec a disco
      let written = false
      let validation: { passed: boolean; error?: string } = { passed: false, error: "No escrito" }

      if (llmResult.playwright_code?.trim()) {
        try {
          const dir = path.dirname(absPath)
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
          fs.writeFileSync(absPath, llmResult.playwright_code, "utf8")
          written = true
          console.error(`[test-design] escrito ${specFile}`)
          validation = validateSpec(specFile)
        } catch (err) {
          console.error(`[test-design] error escribiendo ${specFile}: ${(err as Error).message}`)
        }
      }

      specDrafts.push({
        spec_file: specFile,
        module: group.module,
        scenarios_count: (llmResult.scenarios ?? []).length,
        code: llmResult.playwright_code ?? "",
        written,
        validation_passed: validation.passed,
        validation_error: validation.error,
      })
    }

    // ACs que siguen sin cobertura
    const stillMissing = [
      ...input.missing_criteria.filter(id => !coveredCriteria.has(id)),
      ...unresolvedACs,
      ...input.missing_risks.filter(id => !coveredRisks.has(id)),
    ]

    const output: TestDesignOutput = {
      scenarios: allScenarios,
      spec_drafts: specDrafts,
      covered_criteria: [...coveredCriteria],
      covered_risks: [...coveredRisks],
      still_missing: [...new Set(stillMissing)],
    }

    span.end(output, {
      scenarios: allScenarios.length,
      specs_written: specDrafts.filter(d => d.written).length,
      still_missing: stillMissing.length,
    })

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
    console.error("Uso: npx ts-node src/agents/test-design-agent.ts '<TestDesignInput JSON>'")
    process.exit(1)
  }

  const input = JSON.parse(raw) as TestDesignInput

  runTestDesignAgent(input)
    .then(output => {
      console.error(`\n✓ Escenarios: ${output.scenarios.length}`)
      console.error(`  Specs escritos: ${output.spec_drafts.filter(d => d.written).length}/${output.spec_drafts.length}`)
      console.error(`  ACs cubiertos: ${output.covered_criteria.length}`)
      console.error(`  Aún pendientes: ${output.still_missing.length}`)
      if (output.still_missing.length > 0) {
        console.error(`  Pendientes: ${output.still_missing.join(", ")}`)
      }
      console.log(JSON.stringify(output, null, 2))
    })
    .catch(err => {
      console.error(JSON.stringify({ error: err.message }))
      process.exit(1)
    })
}
