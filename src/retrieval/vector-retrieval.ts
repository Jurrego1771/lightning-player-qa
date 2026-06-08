/**
 * vector-retrieval.ts
 *
 * Wrapper tipado sobre Qdrant para búsqueda semántica.
 * Consolida la lógica que estaba inline en change-analysis y risk agents.
 *
 * Colecciones:
 *   knowledge_chunks — fragmentos de behavior.json/context.yaml
 *   test_corpus      — specs Playwright existentes
 */

import { QdrantClient } from "@qdrant/js-client-rest"
import { pipeline as hfPipeline, FeatureExtractionPipeline } from "@xenova/transformers"
import * as dotenv from "dotenv"

dotenv.config()

const QDRANT_URL = process.env.QDRANT_URL ?? "http://localhost:6333"
const MODEL_NAME = "Xenova/multilingual-e5-small"

let _client: QdrantClient | null = null
let _embedder: FeatureExtractionPipeline | null = null

function getClient(): QdrantClient {
  if (!_client) _client = new QdrantClient({ url: QDRANT_URL })
  return _client
}

async function getEmbedder(): Promise<FeatureExtractionPipeline> {
  if (!_embedder) {
    _embedder = await hfPipeline("feature-extraction", MODEL_NAME, { revision: "main" }) as FeatureExtractionPipeline
  }
  return _embedder
}

async function embed(text: string): Promise<number[]> {
  const embedder = await getEmbedder()
  const out = await embedder(text, { pooling: "mean", normalize: true })
  return Array.from(out.data as Float32Array)
}

// ─── Tipos de resultado ───────────────────────────────────────────────────────

export interface VectorHit {
  id: string | number
  score: number
  payload: Record<string, unknown>
}

// ─── Búsquedas ────────────────────────────────────────────────────────────────

/**
 * Busca chunks de conocimiento similares al texto dado.
 * Usado por: change-analysis (similar past changes), risk-agent (semantic bugs)
 */
export async function searchKnowledge(
  query: string,
  opts: { limit?: number; filter?: Record<string, unknown> } = {}
): Promise<VectorHit[]> {
  try {
    const client = getClient()
    const vector = await embed(`query: ${query}`)

    const result = await client.search("knowledge_chunks", {
      vector,
      limit: opts.limit ?? 5,
      with_payload: true,
      filter: opts.filter as Record<string, unknown> | undefined,
    })

    return result.map(r => ({
      id:      r.id,
      score:   r.score,
      payload: (r.payload ?? {}) as Record<string, unknown>,
    }))
  } catch {
    return []  // Qdrant no disponible — graceful fallback
  }
}

/**
 * Busca specs de test similares a la consulta.
 * Usado por: test-selection (encontrar specs candidatos)
 */
export async function searchTestCorpus(
  query: string,
  opts: { limit?: number; modules?: string[] } = {}
): Promise<VectorHit[]> {
  try {
    const client = getClient()
    const vector = await embed(`query: ${query}`)

    const filter = opts.modules?.length
      ? { must: [{ key: "module", match: { any: opts.modules } }] }
      : undefined

    const result = await client.search("test_corpus", {
      vector,
      limit: opts.limit ?? 10,
      with_payload: true,
      filter: filter as Record<string, unknown> | undefined,
    })

    return result.map(r => ({
      id:      r.id,
      score:   r.score,
      payload: (r.payload ?? {}) as Record<string, unknown>,
    }))
  } catch {
    return []
  }
}

/**
 * Busca ACs similares semánticamente.
 * Usado por: evaluator (verificar si un claim tiene evidencia semántica)
 */
export async function searchSimilarACs(
  scenario: string,
  opts: { limit?: number; modules?: string[] } = {}
): Promise<VectorHit[]> {
  return searchKnowledge(scenario, {
    limit: opts.limit ?? 5,
    filter: opts.modules?.length
      ? { must: [{ key: "type", match: { value: "acceptance_criteria" } }, { key: "module", match: { any: opts.modules } }] }
      : { must: [{ key: "type", match: { value: "acceptance_criteria" } }] },
  })
}

/**
 * Índice de un chunk en Qdrant.
 * Usado por scripts de migración.
 */
export async function upsertChunk(
  collection: string,
  id: number,
  text: string,
  payload: Record<string, unknown>
): Promise<void> {
  const client = getClient()
  const vector = await embed(`passage: ${text}`)
  await client.upsert(collection, {
    wait: true,
    points: [{ id, vector, payload }],
  })
}
