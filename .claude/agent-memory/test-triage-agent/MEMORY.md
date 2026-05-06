# MEMORY INDEX — test-triage-agent

## Sessions
- [sessions/2026-04-24_qoe-performance-triage.md](sessions/2026-04-24_qoe-performance-triage.md) — QoE performance tests: 5 defects found, all test defects, no real player bugs
- [sessions/2026-04-24_events-spec-triage.md](sessions/2026-04-24_events-spec-triage.md) — events.spec.ts: 9/10 correct, 1 defect (canplaythrough race), load-order test is structurally sound
- [sessions/2026-04-25_analytics-comscore-triage.md](../../memory/sessions/2026-04-25_analytics-comscore-triage.md) — 13/13 failures are test defects: mockContentConfig puts tracking at wrong JSON path
- [sessions/2026-04-25_a11y-audio-triage.md](sessions/2026-04-25_a11y-audio-triage.md) — a11y audio test defect: view:'audio' no existe como view type; afecta multiple specs
- [sessions/2026-04-28_youbora-triage.md](sessions/2026-04-28_youbora-triage.md) — 16/23 failures, all test defects: YOUBORA_CONFIG uses wrong path (tracking.youbora instead of metadata.player.tracking.youbora)
- [sessions/2026-05-06_system73-triage.md](sessions/2026-05-06_system73-triage.md) — 3 failures ENVIRONMENT (wrong player build, not on feature/system73); secondary defect: loadConfig rest-spread trap in peering config path

## Recurring patterns
- [patterns/always-zero-measurement-trap.md](patterns/always-zero-measurement-trap.md) — measureStartup() and bufferingRatio both produce permanent false-positive green coverage
- [patterns/waitforevent-stale-match.md](patterns/waitforevent-stale-match.md) — waitForEvent() uses array.includes(), matches pre-existing events; must flush array before seek/state-change tests
- [patterns/canplaythrough-backfill-gap.md](patterns/canplaythrough-backfill-gap.md) — harness does not backfill canplaythrough; autoplay=true + waitForEvent('canplaythrough') is flaky on warm CDN
- [patterns/mockcontent-config-path-mismatch.md](patterns/mockcontent-config-path-mismatch.md) — mockContentConfig top-level keys land at options.metadata.* not options.*; tracking must nest under player.tracking to reach plugins/index.js
- [patterns/audio-view-type-invalid.md](patterns/audio-view-type-invalid.md) — view:'audio' no existe en playerView map; causa timeout en loadMSPlayer; usar 'radio' o 'compact' para audio
