---
name: loadedmetadata-hls-lazy-chunk-race
description: waitForEvent('loadedmetadata') times out with autoplay=false because the HLS lazy chunk hasn't mounted yet when loadMSPlayer().then() runs — readyState is undefined, backfill skips loadedmetadata, 15s timeout is insufficient on slow CI
type: feedback
---

# loadedmetadata / HLS Lazy-Chunk Race Pattern

## What happens

The harness backfill at `harness/index.html:145-148` adds `loadedmetadata` only when
`player.readyState >= 1`. But `readyState` is exposed via a getter that delegates to
the internal `_handler` ref. When the React.Suspense boundary for the HLS lazy chunk
has not yet resolved, `_handler` is null and `player.readyState` is `undefined`.

Result: backfill condition is false, `loadedmetadata` is never added to `__qa.events`,
and any call to `waitForEvent('loadedmetadata', 15_000)` will timeout — even with
`autoplay: false`.

## When this causes failures

Pattern that fails:
```ts
await isolatedPlayer.goto({ type: 'media', id: MockContentIds.vod, autoplay: false })
await isolatedPlayer.waitForReady()
await isolatedPlayer.waitForEvent('loadedmetadata', 15_000)  // FLAKY
```

`waitForReady()` resolves when `loadMSPlayer().then()` completes. At that moment,
the HLS lazy chunk may still be loading (React.Suspense). `player.readyState` is
`undefined`. Backfill skips `loadedmetadata`. The 15s wait then depends entirely
on the real event firing — which requires the HLS chunk to finish loading AND for
the media element to reach `readyState=1`. On slow CI or cold cache this exceeds 15s.

## Affected tests (confirmed)

- `tests/contract/player-api.spec.ts` — "propiedades requeridas existen con el tipo correcto"
- `tests/contract/player-api-format-param.spec.ts` — "sin format param: backward compat"

Both have inline comments acknowledging this race. Both use `isolatedPlayer` (mocked
platform, local HLS stream). Both timeout consistently across 2 retries.

## Fix strategy (for test-defect-corrector)

Replace `waitForEvent('loadedmetadata', 15_000)` with an `expect.poll` that directly
checks `player.readyState >= 1`, bypassing the event backfill entirely:

```ts
await expect.poll(
  () => isolatedPlayer.page.evaluate(() => (window as any).__player?.readyState ?? 0),
  { timeout: 30_000, intervals: [500] }
).toBeGreaterThanOrEqual(1)
```

This is resilient to the Suspense timing gap: it polls the actual property rather
than waiting for an event that may have been missed.

## Why this is distinct from canplaythrough-backfill-gap

`canplaythrough-backfill-gap` affects `autoplay=true` runs where the event fires
before `.then()` runs. This pattern affects `autoplay=false` runs where the backfill
condition itself evaluates to false because `readyState` is undefined at backfill time.
Different cause, same symptom (timeout), requires a different fix strategy.

## Classification signal

If a test fails with `TimeoutError: page.waitForFunction Timeout` at
`waitForEvent('loadedmetadata', ...)` after `waitForReady()` with `autoplay=false`
and `isolatedPlayer` → classify as **TEST_DEFECT / flaky-wait** immediately.
