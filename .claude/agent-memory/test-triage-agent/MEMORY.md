# MEMORY INDEX — test-triage-agent

## Sessions (recientes)
- [sessions/2026-05-06_system73-triage.md](sessions/2026-05-06_system73-triage.md) — 3 failures ENVIRONMENT (wrong player build); secondary defect: loadConfig rest-spread trap in peering config path

## Recurring patterns — consultar antes de clasificar un fallo
- [patterns/always-zero-measurement-trap.md](patterns/always-zero-measurement-trap.md) — measureStartup() y bufferingRatio producen false-positive verde permanente
- [patterns/waitforevent-stale-match.md](patterns/waitforevent-stale-match.md) — waitForEvent() usa array.includes(); matchea eventos previos; hay que vaciar el array antes de seek/state-change
- [patterns/canplaythrough-backfill-gap.md](patterns/canplaythrough-backfill-gap.md) — harness no hace backfill de canplaythrough; autoplay=true + waitForEvent('canplaythrough') es flaky en CDN caliente
- [patterns/mockcontent-config-path-mismatch.md](patterns/mockcontent-config-path-mismatch.md) — mockContentConfig pone las top-level keys en options.metadata.* no en options.*; tracking debe estar bajo player.tracking
- [patterns/audio-view-type-invalid.md](patterns/audio-view-type-invalid.md) — view:'audio' no existe en playerView map; usar 'radio' o 'compact' para audio
- [patterns/loadedmetadata-hls-lazy-chunk-race.md](patterns/loadedmetadata-hls-lazy-chunk-race.md) — waitForEvent('loadedmetadata') timeout con autoplay=false: HLS lazy chunk no montó aún, readyState=undefined, backfill no aplica; fix: expect.poll sobre readyState
