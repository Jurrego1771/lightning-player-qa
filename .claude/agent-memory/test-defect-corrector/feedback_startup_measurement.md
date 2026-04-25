---
name: Startup measurement requires beforeInit timestamp — not wallT0 before goto()
description: To measure true player startup latency (loadMSPlayer call to first frame), capture timestamp in beforeInit hook, not before goto(). 3s threshold covers loadMSPlayer-to-firstFrame only.
type: feedback
---

`measureStartup()` is called AFTER `player.goto()` returns. `goto()` waits for `__qa.initialized === true`, which means the player has already completed initialization (and likely backfilled 'playing'). By the time `measureStartup()` runs, `video.currentTime > 0` is typically already true.

**Correct timestamp placement:**
```typescript
let playerInitT0 = 0
await player.goto(
  { type: 'media', id: ContentIds.vodShort, autoplay: true },
  { beforeInit: async () => { playerInitT0 = Date.now() } }
)
const metrics = await measureStartup(page, playerInitT0)
```

The `beforeInit` hook fires after the player script loads but before `loadMSPlayer()` is called. This gives a measurement from "loadMSPlayer() call" to "currentTime > 0" — the true player startup latency, excluding player script download time.

**Why not `wallT0 = Date.now()` before `goto()`:** That includes player script download (~1.5s CDN) + platform API request (~200ms) + buffering. Total cold start > 3s, making the 3s threshold unreachable on first run. The `beforeInit` approach isolates the player-specific latency.

**The 3s threshold (THRESHOLDS.startupMs):** Valid when measured from `beforeInit`. Typical values: 1.9-2.3s on warm runs. Cold run can be 3-4s (first DNS lookup) — the existing `retries: 1` in playwright.config.ts handles this.
