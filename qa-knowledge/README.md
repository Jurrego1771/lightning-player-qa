# qa-knowledge

Per-module behavior oracles and QA context for the Lightning Player pipeline. Each module directory contains a `context.yaml` (paths, criticality, dependencies, test suite requirements) and a `behavior.json` (events, API contracts, acceptance criteria, known bugs). Agents query this knowledge via `scripts/query-context.ts` — one call returns focused JSON for the modules relevant to a diff, replacing ad-hoc file reads across `context/features/` and `risk_map.yaml`. Schemas in `schemas/` define the contract for both file types.
