/**
 * claude-cli.ts
 *
 * Adapter para llamar al Claude Code CLI en lugar del Anthropic SDK.
 * No requiere ANTHROPIC_API_KEY — usa la auth del CLI instalado.
 *
 * Uso:
 *   const text = await callClaude("prompt aquí", { model: "sonnet" })
 *
 * Internamente corre:
 *   claude -p "<prompt>" --output-format json
 *
 * Output JSON del CLI:
 *   { type: "result", subtype: "success", result: "...", cost_usd: 0.001, ... }
 */

import { spawnSync } from "child_process"

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface ClaudeCliOptions {
  model?: "haiku" | "sonnet" | "opus"
  maxTokens?: number          // ignorado por CLI pero lo aceptamos por compatibilidad
  timeoutMs?: number
}

interface ClaudeCliOutput {
  type: string
  subtype: string
  result: string
  is_error: boolean
  cost_usd?: number
  duration_ms?: number
}

// Model alias → ID completo
const MODEL_IDS: Record<string, string> = {
  haiku:  "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-4-6",
  opus:   "claude-opus-4-8",
}

// ─── Función principal ────────────────────────────────────────────────────────

/**
 * Llama al Claude CLI de forma sincrónica (dentro de async para uniformidad).
 * Devuelve el texto de respuesta crudo.
 * Lanza Error si el CLI falla o devuelve is_error:true.
 */
export async function callClaude(
  prompt: string,
  opts: ClaudeCliOptions = {}
): Promise<string> {
  const model = opts.model ? MODEL_IDS[opts.model] ?? opts.model : undefined
  const timeoutMs = opts.timeoutMs ?? 120_000

  const args = ["-p", prompt, "--output-format", "json"]
  if (model) args.push("--model", model)

  const proc = spawnSync("claude", args, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,   // 20 MB — respuestas largas de risk/test-design
    timeout: timeoutMs,
  })

  if (proc.error) {
    throw new Error(`Claude CLI spawn error: ${proc.error.message}`)
  }

  if (proc.status !== 0) {
    const stderr = proc.stderr?.trim() ?? ""
    throw new Error(`Claude CLI exited ${proc.status}: ${stderr.slice(0, 300)}`)
  }

  const raw = proc.stdout?.trim() ?? ""
  if (!raw) throw new Error("Claude CLI: respuesta vacía")

  try {
    const parsed = JSON.parse(raw) as ClaudeCliOutput
    if (parsed.is_error) {
      throw new Error(`Claude CLI is_error: ${parsed.result}`)
    }
    if (parsed.type !== "result") {
      throw new Error(`Claude CLI tipo inesperado: ${parsed.type}`)
    }
    return parsed.result
  } catch (e) {
    // Si no es JSON válido (raro), devolver raw como texto
    if (raw.startsWith("{")) throw e
    return raw
  }
}

/**
 * Versión que extrae JSON del texto de respuesta.
 * El prompt debe pedir "Responde SOLO con JSON: {...}".
 */
export async function callClaudeJson<T>(
  prompt: string,
  opts: ClaudeCliOptions = {}
): Promise<T> {
  const text = await callClaude(prompt, opts)

  // Extraer primer bloque JSON del texto
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error(`No JSON en respuesta de Claude: ${text.slice(0, 200)}`)

  return JSON.parse(match[0]) as T
}
