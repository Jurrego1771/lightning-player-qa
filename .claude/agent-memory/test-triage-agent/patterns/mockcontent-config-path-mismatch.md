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

---

## Variant 2: loadConfig rest-spread trap (content config)

**Rule:** When passing data that should reach `context.metadata.*` via `mockContentConfig()`, pass the key at the **top level of the override**, NOT wrapped inside a `metadata: {}` envelope.

**Why:** `loadConfig.js` (~line 226) destructures only known fields from the content config response (`src`, `drm`, `poster`, `title`, `description`, `ads`, `account`, `dvr`, `subtitles`, `ad_insertion_google`, `ad_insertion`, `reactions`). Everything else lands in the rest-spread `...metadata` which becomes `context.metadata`. If you wrap your data in `{ metadata: { peering: {...} } }`, the `metadata` key is unknown and goes through the spread → `context.metadata.metadata.peering` — one level too deep.

**Wrong:** `mockContentConfig(page, { metadata: { peering: { system73: { enabled: true, ... } } } })`
→ context.metadata.metadata.peering.system73 (wrong)

**Correct:** `mockContentConfig(page, { peering: { system73: { enabled: true, ... } } })`
→ context.metadata.peering.system73 (correct)

**Seen in:** system73-hls.spec.ts (2026-05-06).
