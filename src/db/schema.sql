-- QA Platform Schema v1.0

-- Módulos del player con señales de riesgo
CREATE TABLE IF NOT EXISTS modules (
  id TEXT PRIMARY KEY,
  criticality TEXT NOT NULL CHECK (criticality IN ('critical','high','medium','low')),
  risk_score FLOAT NOT NULL DEFAULT 0.5,
  risk_label TEXT NOT NULL CHECK (risk_label IN ('critical','high','medium','low')),
  files TEXT[],
  notes TEXT,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Señales de riesgo por módulo (historial)
CREATE TABLE IF NOT EXISTS risk_signals (
  id SERIAL PRIMARY KEY,
  module_id TEXT NOT NULL REFERENCES modules(id),
  signal TEXT NOT NULL,  -- commit_frequency_90d | bugs_closed_90d | ci_failure_rate | ...
  value FLOAT NOT NULL,
  measured_at DATE NOT NULL DEFAULT CURRENT_DATE
);

-- Criterios de aceptación
CREATE TABLE IF NOT EXISTS acceptance_criteria (
  id TEXT PRIMARY KEY,
  module_id TEXT NOT NULL REFERENCES modules(id),
  scenario TEXT NOT NULL,
  given TEXT,
  when_clause TEXT,
  then_clause TEXT,
  priority TEXT NOT NULL CHECK (priority IN ('MUST','SHOULD','COULD')),
  covered_by TEXT[],   -- spec file paths
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','covered','stale'))
);

-- Defectos conocidos
CREATE TABLE IF NOT EXISTS defects (
  id TEXT PRIMARY KEY,
  module_id TEXT NOT NULL REFERENCES modules(id),
  description TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('critical','high','medium','low')),
  status TEXT NOT NULL CHECK (status IN ('open','closed','wont-fix','known')),
  ac_ids TEXT[],
  workaround TEXT,
  platforms TEXT[],
  created_at TIMESTAMP DEFAULT NOW()
);

-- Resultados de ejecuciones de tests
CREATE TABLE IF NOT EXISTS test_results (
  id SERIAL PRIMARY KEY,
  spec_file TEXT NOT NULL,
  test_name TEXT,
  ac_id TEXT,
  module_id TEXT,
  passed BOOLEAN NOT NULL,
  duration_ms INTEGER,
  error_message TEXT,
  run_at TIMESTAMP NOT NULL DEFAULT NOW(),
  pipeline_ref TEXT   -- PR | commit | branch que disparó el run
);

-- Aprendizajes de agentes (memoria de largo plazo)
CREATE TABLE IF NOT EXISTS agent_learnings (
  id SERIAL PRIMARY KEY,
  feature TEXT,
  module_id TEXT,
  pattern TEXT NOT NULL,
  context JSONB,
  confidence FLOAT NOT NULL DEFAULT 0.8 CHECK (confidence BETWEEN 0 AND 1),
  source TEXT NOT NULL CHECK (source IN ('evaluator','human','post-mortem','agent')),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Pipeline runs (trazabilidad de ejecuciones del pipeline completo)
CREATE TABLE IF NOT EXISTS pipeline_runs (
  id SERIAL PRIMARY KEY,
  ref TEXT NOT NULL,            -- PR | commit | branch
  ref_type TEXT NOT NULL CHECK (ref_type IN ('pr','commit','branch','release')),
  change_analysis JSONB,
  risks JSONB,
  dependencies JSONB,
  selected_tests JSONB,
  evaluation JSONB,
  verdict TEXT CHECK (verdict IN ('PASS','REGENERATE','HUMAN_REVIEW')),
  langfuse_trace_id TEXT,
  started_at TIMESTAMP DEFAULT NOW(),
  finished_at TIMESTAMP
);

-- Índices de performance
CREATE INDEX IF NOT EXISTS idx_ac_module ON acceptance_criteria(module_id);
CREATE INDEX IF NOT EXISTS idx_ac_priority ON acceptance_criteria(priority);
CREATE INDEX IF NOT EXISTS idx_defects_module ON defects(module_id);
CREATE INDEX IF NOT EXISTS idx_test_results_spec ON test_results(spec_file);
CREATE INDEX IF NOT EXISTS idx_test_results_run ON test_results(run_at);
CREATE INDEX IF NOT EXISTS idx_learnings_feature ON agent_learnings(feature);
CREATE INDEX IF NOT EXISTS idx_learnings_module ON agent_learnings(module_id);
CREATE INDEX IF NOT EXISTS idx_risk_signals_module ON risk_signals(module_id);
