---
name: Always-Zero Measurement Trap
description: Performance helpers that return 0 or -1 sentinel values which satisfy threshold assertions, producing permanently green tests with no real measurement
type: feedback
---

# Always-Zero Measurement Trap

Two instances found in 2026-04-24 session in helpers/qoe-metrics.ts:

## Instance 1: measureStartup() returns -1

measureStartup() registers HTMLMediaElement event listeners (loadedmetadata, canplay)
inside a page.evaluate() Promise. By the time it is called, player.goto() has already
returned — meaning the player is initialized and the events have already fired.
One-time HTML5 events never re-fire. Result: timeToLoadedMetadata = -1, timeToCanPlay = -1.

timeToFirstFrame is computed via requestAnimationFrame polling currentTime > 0.
If the player has already advanced currentTime (autoplay), this may resolve quickly
but with measurement starting AFTER playback already began — the time is meaningless.

**Fix direction:** measureStartup() must be called with listeners installed BEFORE
loadMSPlayer() is invoked. Use the beforeInit hook in LightningPlayerPage.goto().
Alternatively: switch to Navigation Timing API marks injected by the player script.

**Danger assertion:** expect(metrics.X).toBeLessThan(threshold)
Any negative number passes any positive threshold. Always add:
  expect(metrics.X, 'must be real measurement').toBeGreaterThan(0)

## Instance 2: PlaybackMetricsCollector bufferingRatio always 0.0

The class fields stallStart and totalStallMs are declared but never updated.
The browser-side listener increments stallCount (a count) but not stall duration.
Result: totalStallMs = 0, bufferingRatio = 0.0 / totalPlayTime = 0.0 always.

**Fix direction:** In startCollecting() browser-side code, track stall START time
on 'waiting' event and accumulate duration on 'playing' event. Pass totalStallMs
back via collectFinal() instead of using the TypeScript class field.

**Why:** The stall duration is a browser-side metric — it must be measured inside
the page context where the events fire. The TypeScript class field approach requires
postMessage or CDP-level observation which is more complex. Keep it browser-side.

## Prevention rule

When writing a new performance helper that returns a metric:
1. Add a lower-bound assertion (> 0 or > some realistic minimum)
2. Add a comment explaining when the metric would return -1 or 0 (error case)
3. Test the helper against a known bad stream to confirm the error case is distinguishable
