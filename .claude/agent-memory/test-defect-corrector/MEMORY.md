# MEMORY INDEX — test-defect-corrector

## Sessions (recientes)
- [session_2026-05-06_system73-corrections.md](session_2026-05-06_system73-corrections.md) — Fixed mockContentConfig path en system73-hls (6/6 pass); DASH bloqueado: no hay vod-dash fixture, dash.json apunta a fake.mpd

## Feedback persistente — leer antes de corregir cualquier test
- [feedback_player_init_requires_id.md](feedback_player_init_requires_id.md) — Los tests de performance deben usar ContentIds (no src); el fixture player requiere platform content ID para evitar 404
- [feedback_startup_measurement.md](feedback_startup_measurement.md) — measureStartup() debe usar timestamp del hook beforeInit; el threshold de 3s es para loadMSPlayer()-to-firstFrame, no duración total del test
