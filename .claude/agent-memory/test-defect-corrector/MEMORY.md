# MEMORY INDEX — test-defect-corrector

- [session_2026-04-24_qoe-corrections.md](session_2026-04-24_qoe-corrections.md) — Fixed 5 defects in qoe-metrics.spec.ts + helpers/qoe-metrics.ts; critical finding: src-only player init causes 404 from develop.mdstrm.com
- [feedback_player_init_requires_id.md](feedback_player_init_requires_id.md) — Performance tests must use ContentIds (not src), player fixture requires platform content ID to avoid 404
- [feedback_startup_measurement.md](feedback_startup_measurement.md) — measureStartup() must use beforeInit hook timestamp; 3s threshold is for loadMSPlayer()-to-firstFrame, not total test duration
- [session_2026-04-24_canplaythrough-race.md](session_2026-04-24_canplaythrough-race.md) — canplaythrough is not in harness backfill; autoplay=true races ahead of listener registration; fix: autoplay=false + waitForReady() + play()
- [session_2026-04-26_dash-handler-race.md](session_2026-04-26_dash-handler-race.md) — DASH handler race: player.handler='' after waitForReady(); player:dynamic blocks pluginsReady(); DASH E2E gap: no valid content ID in DEV
- [session_2026-05-06_system73-corrections.md](session_2026-05-06_system73-corrections.md) — Fixed mockContentConfig path in system73-hls (6/6 pass); DASH blocked: no vod-dash fixture, dash.json points to fake.mpd
