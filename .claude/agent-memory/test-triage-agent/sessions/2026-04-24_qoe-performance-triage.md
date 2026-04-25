---
name: QoE Performance Tests Triage — 2026-04-24
description: Full triage of tests/performance/qoe-metrics.spec.ts — all 5 issues are test defects, no real player bugs
type: project
---

# QoE Performance Tests Triage — 2026-04-24

## Context

Triggered after Streams.hls.vod was changed from a 403-returning Akamai URL to
the Apple bipbop fmp4 CDN stream. The stream-health.ts guard was also fixed,
meaning the Buffer Health / Session / Seek tests were about to run for the first
time. Static analysis was performed before the first real run.

## What we found

### Issue 1 — CRITICAL: measureStartup() always returns -1 (Startup tests)
- File: helpers/qoe-metrics.ts, measureStartup() function, line 64
- Root cause: measureStartup() is called AFTER player.goto() returns. By that point
  the player has already played through loadedmetadata and canplay — these are
  one-time HTML5 events that will never fire again. All three metric fields stay -1.
- Impact: Startup tests always pass (expect(-1).toBeLessThan(3000) is true).
  Zero measurement quality — these tests cannot detect startup regressions.
- Correction doc: triage/test-corrections/2026-04-24_measurestartup-returns-negative-one.json

### Issue 2 — MEDIUM: Buffer forward test (buffer health ≥ 5s)
- File: tests/performance/qoe-metrics.spec.ts, line 77
- Root cause: bufferedAhead calculation assumes single contiguous buffered range
  (uses video.buffered.end(last) - currentTime), which overestimates during ABR switches.
  Also: no readyState guard — if video element not found, returns 0 silently for 15s.
- Impact: Assertion structure is correct (expect.poll ≥ 5s). Risk is diagnostic quality
  on failure, not false positives. Added readyState guard in correction.
- Correction doc: triage/test-corrections/2026-04-24_buffer-forward-wrong-fixture.json

### Issue 3 — HIGH: Buffer 3G test assertion threshold too weak
- File: tests/performance/qoe-metrics.spec.ts, line 95
- Root cause: Assertion is bufferedAhead > 0 — trivially achievable with one buffered frame.
  Additionally, CDP throttle is applied before player script download, making script
  load slow under 500 Kbps and introducing flakiness on slow CI.
- Impact: Test always passes. Cannot detect any ABR degradation under 3G.
- Correction doc: triage/test-corrections/2026-04-24_buffer-3g-assertion-too-weak.json

### Issue 4 — CRITICAL: Session 30s — bufferingRatio is always 0.0
- File: helpers/qoe-metrics.ts, PlaybackMetricsCollector class
- Root cause (two sub-issues):
  (a) stallStart/totalStallMs class fields are declared but never updated.
      The browser-side listener increments stallCount but not duration.
      totalStallMs = 0 always, so bufferingRatio = 0 / totalPlayTime = 0.0 always.
  (b) 'levelchanged' listener is attached to the video element (HTMLMediaElement),
      but levelchanged is a custom player event — it fires on the player object, not
      the video element. qualitySwitches = 0 always, averageBitrate = 0 always.
- Impact: Session test always passes. Cannot detect buffering regressions.
  The waitForTimeout(30_000) is LEGITIMATE — do not remove it.
- Correction doc: triage/test-corrections/2026-04-24_session-30s-stall-tracking-broken.json

### Issue 5 — HIGH: Seek latency test — stale event match produces 0ms latency
- File: tests/performance/qoe-metrics.spec.ts, line 156
- Root cause: waitForEvent() uses window.__qa.events.includes() which matches
  ANY prior occurrence. After the initial player.waitForEvent('playing') resolves,
  'playing' is in the array. The post-seek waitForEvent('playing') resolves
  instantly — seekLatency measures near 0ms.
  Also: no player.assertCurrentTimeNear() — seek success is not verified.
- Impact: Test always passes with ~0-50ms latency. Cannot detect seek performance regressions.
- Correction doc: triage/test-corrections/2026-04-24_seek-latency-wrong-event-order.json

## Key architectural insight discovered

The waitForEvent() implementation in fixtures/player.ts uses Array.includes() on
the cumulative events array. This is a systemic limitation: any test that:
  (a) waits for event X to confirm setup, then
  (b) triggers an action that should fire event X again, then
  (c) immediately calls waitForEvent(X) again
...will always resolve instantly using the stale pre-action entry. Any seek, pause/resume,
or state-change test that calls waitForEvent() after a similar prior event must flush
the relevant events from __qa.events before the action.

This is not a bug in player.ts — it is a documented usage constraint. Tests must
manage the event array appropriately.

## Classification summary

All 5 issues are TEST DEFECTS. No real player bugs identified in this session.
The Apple CDN bipbop fmp4 stream (Streams.hls.vod) is appropriate for these tests
(multi-bitrate, ~10 min duration, fmp4 segments, publicly accessible).

## Pending for next session

1. Implement fix for measureStartup() — requires restructuring to register listeners
   before player init (use beforeInit hook) or switch to Navigation Timing API.
2. Implement fix for PlaybackMetricsCollector stall tracking — add stallStart/totalStallMs
   accumulation in browser-side evaluate().
3. Fix levelchanged listener — use window.__qa.events filter instead of video element listener.
4. Add event-array flush pattern before all seek/state-change measurements.
5. Run the corrected tests to confirm they produce non-trivial measurements.
