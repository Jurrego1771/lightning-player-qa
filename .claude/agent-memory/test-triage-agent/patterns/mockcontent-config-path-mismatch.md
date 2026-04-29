---
name: mockPlayerConfig / mockContentConfig path mismatch
description: Tracking config must nest under metadata.player to reach plugins/index.js; top-level keys are not read by analytics plugins
type: feedback
---

# mockPlayerConfig / mockContentConfig path mismatch

**Rule:** When using `mockPlayerConfig()` to enable analytics plugins (Youbora, Comscore), the config must be nested under `metadata.player.tracking`, NOT at the top level of the override object.

**Why:** `api.js` merges the player config response at the ROOT of `finalConfig`. But `plugins/index.js` reads analytics flags from `options.metadata.player.tracking.*` — which comes from the **content config** response embedded player object. Top-level keys like `tracking.youbora` in the player config body land at `finalConfig.tracking`, not at `finalConfig.metadata.player.tracking`.

**How to apply:**
- Wrong: `mockPlayerConfig(page, { tracking: { youbora: { enabled: true, account_code: '...' } } })`
- Correct: `mockPlayerConfig(page, { metadata: { player: { tracking: { youbora: { enabled: true, account_code: '...' } } } } })`

**Exception:** Comscore has a dual-path fallback in plugins/index.js (`|| options?.tracking?.comscore`), so top-level works for Comscore. Youbora has NO such fallback (as of v1.0.62).

**False positive risk:** Tests that expect 0 beacons will PASS whether the config path is right or wrong, because Youbora never mounts either way. Only tests expecting beacons > 0 will catch the mis-path.

**Seen in:** youbora.spec.ts (2026-04-28), comscore tests (2026-04-25).
