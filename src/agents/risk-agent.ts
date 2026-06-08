/**
 * Risk Agent — Sprint 3
 *
 * Input:  ChangeAnalysisOutput (features, modules, platforms, services, ...)
 * Output: {risks[]} — cada riesgo con id, severity, category, evidence
 *
 * Flujo:
 *   1. PostgreSQL: bugs históricos para módulos afectados
 *   2. PostgreSQL: agent_learnings (patrones aprendidos)
 *   3. Qdrant: known_bugs semánticamente similares
 *   4. Claude Sonnet: genera risks con arquitectura del player como contexto
 *
 * Uso CLI: npx ts-node src/agents/risk-agent.ts '<ChangeAnalysisOutput JSON>'
 */

import { Client as PgClient } from "pg"
import * as dotenv from "dotenv"

import type { RiskAgentInput, RiskAgentOutput, Risk } from "./types"
import { startAgentTrace } from "../observability/tracer"
import { getRiskContext } from "../retrieval/hybrid-retrieval"
import { callClaudeJson } from "../llm/claude-cli"

dotenv.config()

function pgClient() {
  return new PgClient({
    host: process.env.POSTGRES_HOST ?? "localhost",
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    database: process.env.POSTGRES_DB ?? "qa_platform",
    user: process.env.POSTGRES_USER ?? "qa_user",
    password: process.env.POSTGRES_PASSWORD ?? "qa_password",
  })
}

// ─── Conocimiento de arquitectura del player (quemado desde análisis del repo) ──

const PLAYER_ARCHITECTURE_CONTEXT = `
## Lightning Player — Patrones de Riesgo Conocidos (verificados desde código fuente)

### Emitter (src/events/index.js)
- internalEmitter extiende EventEmitter de Node.js
- emit() llama window.postMessage(event, location.origin) automáticamente — todo emit cruza origen
- NO hay try-catch en emit() → error en listener propaga y rompe la cadena de listeners
- 63 archivos importan internalEmitter → cambio en eventos tiene blast radius alto
- ExternalEmitter.on() filtra eventos no en Events enum → listeners externos son seguros
- Riesgo R1: listener falla → cadena completa se rompe

### AdsManager (src/ads/manager/manager/index.js)
- Extiende EventEmitter, tiene 19+ campos privados (#schedule, #running, #currentAdRenderer, etc.)
- Máquina de estados implícita: idle → loaded → started → running → complete
- ResumableIterator para ad playback — estado persistente entre breaks
- No hay validación de transiciones de estado
- Riesgo R2: transición inválida → ads en estado incorrecto, sin reset automático

### Múltiples Proveedores de Ads
- googleIma (16 files), googleDAI (10), googleSGAI (7), adswizz (2), itg (7)
- Todos registran listeners en internalEmitter
- _adsStarted puede ser emitido por múltiples → race condition
- Riesgo R3: dos proveedores activos simultáneamente → eventos duplicados

### Context Global (src/context/index.jsx)
- setData() no valida shape del objeto pasado
- getDerivedStateFromProps tiene DRM logic → efectos secundarios en render
- 30+ componentes leen del Context directamente
- Riesgo R4: setData con key inválida → silencioso, estado inconsistente

### Player Handlers (src/player/base.js)
- Handler selection: HLS via hls.js, DASH via dash.js, native para mp4
- Si handler falla → no hay fallback automático, app entera sin playback
- base.js emite 15+ eventos distintos
- Riesgo R5: handler crash → blank video sin mensaje de error

### Analytics Trackers (src/analytics/tracker.jsx)
- Inicializa 5 trackers en cascada: comscore, youbora, reactions, streammetrics, konodrac
- Error en tracker no aislado → puede prevenir inicialización de trackers siguientes
- Todos escuchan internalEmitter (11 listeners en tracker.jsx)
- Riesgo R6: tracker crash → sesión no registrada, analytics perdidos

### Performance — Event Spam
- _timeupdate y _progress emitidos 24-60 veces/segundo
- Si hay 50+ listeners en _timeupdate → impacto measurable en perf
- Riesgo R7: listeners new en eventos de alta frecuencia → CPU spike

### Memory Leaks
- Listeners registrados en componentDidMount sin off() en componentWillUnmount
- Riesgo R8: instancias acumuladas → heap leak en SPA de larga duración

### MSP Protocol (postMessage cross-window)
- emit() siempre llama postMessage con location.origin
- onWindowMessage filtra por event.origin === location.origin
- En iframe cross-origin: origen diferente → eventos no recibidos
- Riesgo R9: embed en dominio diferente → postMessage silently dropped

### DRM (src/player/drm/plugin.jsx)
- getDerivedStateFromProps selecciona key system (FairPlay/Widevine/PlayReady)
- Si key system no soportado por browser → blank video sin error visible
- Riesgo R10: cambio de key system config → video invisible en producción
`.trim()

// Mapeo módulo → riesgos base (de análisis de código)
const MODULE_RISK_MAP: Record<string, Array<{ id: string; description: string; severity: Risk["severity"]; category: Risk["category"] }>> = {
  "events":         [{ id: "R1", description: "Listener chain failure — emit() sin try-catch, error en listener propaga", severity: "critical", category: "functional" }],
  "ads-manager":    [{ id: "R2", description: "AdsManager state machine inválida — 19 campos privados sin validación de transiciones", severity: "critical", category: "functional" },
                     { id: "R3", description: "Race condition entre proveedores de ads — múltiples listeners en _adsStarted", severity: "high", category: "integration" }],
  "ads-ima":        [{ id: "R3", description: "Race condition IMA vs otro proveedor activo", severity: "high", category: "integration" }],
  "ads-dai":        [{ id: "R3", description: "Race condition DAI vs IMA simultáneo", severity: "high", category: "integration" }],
  "ads-sgai":       [{ id: "R3", description: "SGAI manipula HLS manifest — conflicto con hls.js loader", severity: "high", category: "integration" }],
  "state":          [{ id: "R4", description: "setData() sin validación de shape — estado global inconsistente", severity: "high", category: "functional" }],
  "playback-core":  [{ id: "R5", description: "Handler crash → blank video sin fallback automático", severity: "critical", category: "functional" }],
  "hls":            [{ id: "R5", description: "hls.js handler falla → sin playback para HLS streams", severity: "critical", category: "functional" }],
  "dash":           [{ id: "R5", description: "dash.js handler falla → sin playback para DASH streams", severity: "critical", category: "functional" }],
  "youbora":        [{ id: "R6", description: "Youbora tracker crash → sesión NPAW no registrada, sin datos de QoE", severity: "medium", category: "integration" }],
  "controls-api":   [{ id: "R7", description: "Nuevo listener en _timeupdate/60fps → CPU spike", severity: "medium", category: "performance" }],
  "drm":            [{ id: "R10", description: "Key system config cambia → blank video en browsers sin soporte", severity: "critical", category: "security" }],
  "api-bootstrap":  [{ id: "R1", description: "Bootstrap falla → ningún player carga en la página", severity: "critical", category: "functional" }],
  "constants":      [{ id: "R1", description: "Constantes de eventos cambian → todos los listeners con strings hardcoded rotos", severity: "critical", category: "functional" }],
  "platform-config":[{ id: "R9", description: "Config de origen/dominio cambia → postMessage silently dropped en embeds", severity: "high", category: "security" }],
}

async function getHistoricalBugs(modules: string[]): Promise<string[]> {
  const client = pgClient()
  try {
    await client.connect()
    const result = await client.query<{ id: string; description: string; severity: string }>(
      `SELECT id, description, severity FROM defects
       WHERE module_id = ANY($1) AND status != 'wont-fix'
       ORDER BY severity DESC, created_at DESC
       LIMIT 10`,
      [modules]
    )
    return result.rows.map(r => `${r.id} [${r.severity}]: ${r.description}`)
  } catch {
    return []  // DB no disponible → continuar sin histórico
  } finally {
    await client.end().catch(() => {})
  }
}

async function getLearnings(modules: string[]): Promise<string[]> {
  const { getLearningsForModules, formatMemoryForPrompt, getModuleMemory } = await import("../memory/learning-store")
  const memories = await Promise.all(modules.slice(0, 5).map(m => getModuleMemory(m)))
  const valid = memories.filter(m => m.learnings.length > 0 || m.open_defect_count > 0)
  return valid.length > 0 ? [formatMemoryForPrompt(valid)] : []
}

async function getSemanticBugs(modules: string[], changeSummary: string): Promise<string[]> {
  const ctx = await getRiskContext(modules, changeSummary)

  // Graph defects (ground truth) + vector semantic hits
  const graphBugs = ctx.historicalDefects.map(d =>
    `[${d.severity.toUpperCase()}] ${d.description} (${d.found_in_module}, status: ${d.status})`
  )
  const vectorBugs = ctx.semanticChunks.map(h => String(h.payload["text"] ?? "")).filter(Boolean)

  return [...graphBugs, ...vectorBugs].slice(0, 10)
}

function getBaseRisks(modules: string[]): Array<Omit<Risk, "id">> {
  const seen = new Set<string>()
  const risks: Array<Omit<Risk, "id">> = []

  for (const mod of modules) {
    for (const risk of MODULE_RISK_MAP[mod] ?? []) {
      if (!seen.has(risk.id)) {
        seen.add(risk.id)
        risks.push({
          description: risk.description,
          severity: risk.severity,
          category: risk.category,
          related_modules: [mod],
          historical_bugs: [],
          evidence: `Módulo ${mod} en riesgo ${risk.id} — patrón verificado en código fuente`,
        })
      }
    }
  }

  return risks
}

async function generateRisksWithLLM(
  input: RiskAgentInput,
  historicalBugs: string[],
  learnings: string[],
  semanticBugs: string[],
  baseRisks: Array<Omit<Risk, "id">>
): Promise<Risk[]> {
  const baseRisksStr = baseRisks.length > 0
    ? baseRisks.map(r => `- [${r.severity.toUpperCase()}] ${r.description}`).join("\n")
    : "Ninguno detectado automáticamente"

  const prompt = `Eres un experto QA analizando riesgos de un cambio en el Lightning Player.

## Cambio analizado
Módulos afectados: ${input.affected_modules.join(", ")}
Features: ${input.features.join(", ")}
Plataformas: ${input.platforms.join(", ")}
Servicios: ${input.services.join(", ")}
Tipo de cambio: ${input.change_type}
Resumen: ${input.change_summary}
Cross-cutting: ${input.cross_cutting}

## Arquitectura del Player
${PLAYER_ARCHITECTURE_CONTEXT}

## Riesgos base detectados automáticamente (por mapeo módulo→riesgo)
${baseRisksStr}

## Bugs históricos en estos módulos
${historicalBugs.length > 0 ? historicalBugs.join("\n") : "Sin historial en DB"}

## Patrones aprendidos
${learnings.length > 0 ? learnings.join("\n") : "Sin patrones previos"}

## Bugs similares conocidos (semantic search)
${semanticBugs.length > 0 ? semanticBugs.join("\n") : "Sin similares encontrados"}

## Tu tarea
Genera la lista COMPLETA de riesgos para este cambio. Combina:
1. Los riesgos base ya detectados (refinados con contexto)
2. Riesgos adicionales que identifies según el tipo de cambio y los módulos

Responde SOLO con JSON válido (sin markdown):
{
  "risks": [
    {
      "id": "R001",
      "description": "descripción técnica específica del riesgo",
      "severity": "critical|high|medium|low",
      "category": "functional|security|performance|integration",
      "related_modules": ["módulo1", "módulo2"],
      "historical_bugs": ["BUG-ID-1"],
      "evidence": "por qué existe este riesgo — referencia al código o historial"
    }
  ]
}

Reglas:
- Máximo 8 riesgos, ordenados por severity (critical primero)
- Solo riesgos reales y específicos — no genéricos como "puede haber bugs"
- historical_bugs: solo IDs de bugs del historial provisto arriba
- evidence: siempre mencionar archivo o patrón concreto del player`

  try {
    const parsed = await callClaudeJson<{ risks: Risk[] }>(prompt, { model: "sonnet" })
    return parsed.risks
  } catch {
    return baseRisks.map((r, i) => ({
      ...r,
      id: `R${String(i + 1).padStart(3, "0")}`,
    }))
  }
}

export async function runRiskAgent(input: RiskAgentInput): Promise<RiskAgentOutput> {
  const span = startAgentTrace("risk-agent", input)

  try {
    const [historicalBugs, learnings, semanticBugs] = await Promise.all([
      getHistoricalBugs(input.affected_modules),
      getLearnings(input.affected_modules),
      getSemanticBugs(input.affected_modules, input.change_summary),
    ])

    const baseRisks = getBaseRisks(input.affected_modules)
    const risks = await generateRisksWithLLM(input, historicalBugs, learnings, semanticBugs, baseRisks)

    const output: RiskAgentOutput = { risks }
    span.end(output, { risk_count: risks.length, critical: risks.filter(r => r.severity === "critical").length })
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
    console.error("Uso: npx ts-node src/agents/risk-agent.ts '<ChangeAnalysisOutput JSON>'")
    process.exit(1)
  }

  const input = JSON.parse(raw) as RiskAgentInput

  runRiskAgent(input)
    .then(output => console.log(JSON.stringify(output, null, 2)))
    .catch(err => {
      console.error(JSON.stringify({ error: err.message }))
      process.exit(1)
    })
}
