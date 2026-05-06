---
name: Test Corrections — 2026-05-06 System73
description: Fixed mockContentConfig path defect in system73-hls.spec.ts and system73-dash.spec.ts; documented DASH environment blocker
type: project
---

# Test Corrections — 2026-05-06

## Tests Fixed
- `tests/integration/system73-hls.spec.ts` — wrong_data — Removed `metadata:` wrapper from all 5 `mockContentConfig` calls that passed `peering.system73`. "peering" must be a top-level key of the response object so loadConfig.js rest-spread places it in context.metadata directly.

## Patterns Found

### mockContentConfig rest-spread rule
`mockContentConfig` does a shallow merge: `{ ...base, ...overrides }`. The player's `loadConfig.js` destructs known fields (src, drm, poster, title, description, ads, account, dvr, progress, subtitles, ad_insertion_google, ad_insertion, reactions) and everything else goes into `context.metadata` via rest-spread. Therefore:
- To set `context.metadata.peering`, pass `{ peering: {...} }` as the override (top-level key).
- Passing `{ metadata: { peering: {...} } }` creates `context.metadata.metadata.peering` — wrong.
- This pattern applies to any field that must land in context.metadata: it must be a top-level key of the response, NOT nested under a "metadata" wrapper.

### DASH tests — environment blocker
`tests/integration/system73-dash.spec.ts` — all 7 tests fail because:
1. `localhost:9001/vod-dash/manifest.mpd` does not exist — only HLS fixtures are generated/served.
2. `fixtures/platform-responses/content/dash.json` points to `localhost:9001/vod/fake.mpd` (non-existent).
3. The mock path fix was applied to DASH spec too, but tests remain blocked by missing DASH stream.
Triage file `2026-05-06_system73-environment-wrong-player-build.json` updated with blocker requirements.

## Decisions Made
- Deleted `2026-05-06_system73-mockcontent-metadata-path.json` after HLS spec validated (6/6, two consecutive runs).
- Left `2026-05-06_system73-environment-wrong-player-build.json` in triage with updated status — DASH is a separate unresolved blocker.

## Pending
- Generate DASH stream fixture (`vod-dash/manifest.mpd`) and update `content/dash.json` to point to it.
- Verify player activates dash.js handler when src only has `mpd` key (no `hls`).
- Re-run DASH spec once fixture and build are available.
