import { Langfuse } from "langfuse"

const langfuse = new Langfuse({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY ?? "",
  secretKey: process.env.LANGFUSE_SECRET_KEY ?? "",
  baseUrl: process.env.LANGFUSE_BASE_URL ?? "https://cloud.langfuse.com",
  enabled: !!(process.env.LANGFUSE_PUBLIC_KEY),
})

export interface AgentSpan {
  end: (output: unknown, metadata?: Record<string, unknown>) => void
  error: (error: Error) => void
}

export interface PipelineTrace {
  traceId: string
  agentSpan: (name: string, input: unknown) => AgentSpan
  end: () => Promise<void>
}

export function startPipelineTrace(ref: string, refType: string): PipelineTrace {
  const trace = langfuse.trace({
    name: "qa-pipeline",
    input: { ref, refType },
    metadata: { ref, refType, timestamp: new Date().toISOString() },
  })

  return {
    traceId: trace.id,

    agentSpan(name: string, input: unknown): AgentSpan {
      const span = trace.span({ name, input })
      return {
        end(output: unknown, metadata?: Record<string, unknown>) {
          span.end({ output, metadata })
        },
        error(error: Error) {
          span.end({ output: null, metadata: { error: error.message, stack: error.stack } })
        },
      }
    },

    async end() {
      await langfuse.shutdownAsync()
    },
  }
}

export function startAgentTrace(agentName: string, input: unknown): AgentSpan {
  const trace = langfuse.trace({ name: agentName, input })
  const span = trace.span({ name: `${agentName}.run`, input })
  return {
    end(output: unknown, metadata?: Record<string, unknown>) {
      span.end({ output, metadata })
    },
    error(error: Error) {
      span.end({ output: null, metadata: { error: error.message } })
    },
  }
}
