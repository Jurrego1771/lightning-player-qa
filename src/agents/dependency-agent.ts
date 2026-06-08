/**
 * Dependency Agent — Sprint 4b
 *
 * Input:  {features, affected_modules}
 * Output: {dependencies[]}
 *
 * DETERMINISTA — no LLM. Dos fuentes:
 *   1. context.yaml (depends_on, depended_by, external_dependencies)
 *   2. Git import analysis del player repo (si PLAYER_LOCAL_REPO está configurado)
 *
 * Uso CLI: npx ts-node src/agents/dependency-agent.ts '<DependencyAgentInput JSON>'
 */

import * as fs from "fs"
import * as path from "path"
import * as yaml from "js-yaml"
import { execSync } from "child_process"
import * as dotenv from "dotenv"

import type { DependencyAgentInput, DependencyAgentOutput, Dependency } from "./types"
import { startAgentTrace } from "../observability/tracer"

dotenv.config()

const ROOT = path.join(__dirname, "..", "..")
const MODULES_DIR = path.join(ROOT, "qa-knowledge", "modules")
const RISK_MAP_PATH = path.join(ROOT, "risk_map.yaml")
const PLAYER_REPO = process.env.PLAYER_LOCAL_REPO ?? ""

interface ContextYaml {
  module: string
  criticality: string
  depends_on?: string[]
  depended_by?: string[]
  breaks_if_changed?: string[]
  external_dependencies?: string[]
  paths?: string[]
}

interface RiskMap {
  modules: Record<string, { risk_label: string; files?: string[] }>
}

// ─── Fuente 1: context.yaml ───────────────────────────────────────────────────

function loadContext(modName: string): ContextYaml | null {
  const p = path.join(MODULES_DIR, modName, "context.yaml")
  if (!fs.existsSync(p)) return null
  try {
    return yaml.load(fs.readFileSync(p, "utf8")) as ContextYaml
  } catch {
    return null
  }
}

function getRiskLabel(modName: string, riskMap: RiskMap): string {
  return riskMap.modules[modName]?.risk_label ?? "medium"
}

// ─── Fuente 2: Import analysis del código fuente del player ──────────────────

interface ImportAnalysis {
  from_file: string
  imports_module: string
}

function resolveFileToModule(filePath: string, riskMap: RiskMap): string | null {
  for (const [mod, data] of Object.entries(riskMap.modules)) {
    for (const f of data.files ?? []) {
      if (filePath.includes(f) || f.includes(filePath)) return mod
    }
  }
  return null
}

function analyzeImports(modName: string, riskMap: RiskMap): string[] {
  if (!PLAYER_REPO || !fs.existsSync(PLAYER_REPO)) return []

  const modData = riskMap.modules[modName]
  if (!modData?.files?.length) return []

  const foundModules = new Set<string>()

  for (const filePattern of modData.files) {
    const targetDir = path.join(PLAYER_REPO, filePattern)
    if (!fs.existsSync(targetDir)) continue

    const isDir = fs.statSync(targetDir).isDirectory()
    const files = isDir
      ? findJsFiles(targetDir)
      : [targetDir]

    for (const jsFile of files) {
      try {
        const content = fs.readFileSync(jsFile, "utf8")
        // Extraer imports relativos y mapear a módulos
        const importRe = /(?:import|from)\s+['"](\.[^'"]+)['"]/g
        let m: RegExpExecArray | null
        while ((m = importRe.exec(content)) !== null) {
          const importPath = m[1]
          // Resolver ruta absoluta del import
          const absImport = path.resolve(path.dirname(jsFile), importPath)
          const relImport = path.relative(PLAYER_REPO, absImport).replace(/\\/g, "/")

          const importedMod = resolveFileToModule(relImport, riskMap)
          if (importedMod && importedMod !== modName) {
            foundModules.add(importedMod)
          }
        }
      } catch { /* ignore unreadable files */ }
    }
  }

  return [...foundModules]
}

function findJsFiles(dir: string): string[] {
  const results: string[] = []
  if (!fs.existsSync(dir)) return results
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) results.push(...findJsFiles(full))
    else if (/\.(js|jsx|ts|tsx)$/.test(entry.name)) results.push(full)
  }
  return results
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function runDependencyAgent(input: DependencyAgentInput): Promise<DependencyAgentOutput> {
  const span = startAgentTrace("dependency-agent", input)

  try {
    const riskMap = yaml.load(fs.readFileSync(RISK_MAP_PATH, "utf8")) as RiskMap
    const seen = new Map<string, Dependency>()

    for (const modName of input.affected_modules) {
      const ctx = loadContext(modName)
      const gitDeps = analyzeImports(modName, riskMap)

      // Dependencias declaradas en context.yaml
      const declaredDeps = [
        ...(ctx?.depends_on ?? []),
        ...(ctx?.depended_by ?? []),
      ]

      // Union: context.yaml ∪ git analysis
      const allInternalDeps = new Set([...declaredDeps, ...gitDeps])

      for (const dep of allInternalDeps) {
        if (dep === modName || input.affected_modules.includes(dep)) continue
        if (seen.has(dep)) continue

        const source = (declaredDeps.includes(dep) && gitDeps.includes(dep))
          ? "both"
          : gitDeps.includes(dep)
          ? "git_analysis"
          : "context_yaml"

        const depCtx = loadContext(dep)
        seen.set(dep, {
          module: dep,
          type: "internal",
          criticality: getRiskLabel(dep, riskMap) as Dependency["criticality"],
          source,
          breaks_if_changed: depCtx?.breaks_if_changed ?? [],
        })
      }

      // Dependencias externas (SDKs, CDNs)
      for (const ext of ctx?.external_dependencies ?? []) {
        const extKey = `ext:${ext}`
        if (seen.has(extKey)) continue
        seen.set(extKey, {
          module: ext,
          type: "external",
          criticality: "medium",
          source: "context_yaml",
          breaks_if_changed: [],
        })
      }
    }

    const output: DependencyAgentOutput = {
      dependencies: [...seen.values()],
    }

    span.end(output, { count: output.dependencies.length })
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
    console.error("Uso: npx ts-node src/agents/dependency-agent.ts '<DependencyAgentInput JSON>'")
    process.exit(1)
  }

  const input = JSON.parse(raw) as DependencyAgentInput

  runDependencyAgent(input)
    .then(output => {
      console.error(`\n✓ Dependencias: ${output.dependencies.length} (${output.dependencies.filter(d => d.type === "internal").length} internas, ${output.dependencies.filter(d => d.type === "external").length} externas)`)
      console.log(JSON.stringify(output, null, 2))
    })
    .catch(err => {
      console.error(JSON.stringify({ error: err.message }))
      process.exit(1)
    })
}
