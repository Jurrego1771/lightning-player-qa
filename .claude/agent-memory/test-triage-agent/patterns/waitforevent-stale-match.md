---
name: waitForEvent() Stale Match Pattern
description: waitForEvent() uses Array.includes() on cumulative event log — matches pre-existing events, not post-action events. Must flush relevant events before triggering actions that re-fire them.
type: feedback
---

# waitForEvent() Stale Match Pattern

## How waitForEvent() works

fixtures/player.ts, LightningPlayerPage.waitForEvent():
  page.waitForFunction(
    (name) => window.__qa?.events?.includes(name),
    eventName, { timeout }
  )

window.__qa.events is a CUMULATIVE array that accumulates all event names from
player initialization onward. Once 'playing' is in the array, waitForEvent('playing')
will ALWAYS resolve instantly on the first poll, regardless of whether the player
is currently playing or just re-entered play state.

## When this causes false positives

Pattern that fails:
  1. await player.waitForEvent('playing')  // OK — waits for initial play
  2. await player.seek(60)                 // triggers: seeking, seeked, playing
  3. await player.waitForEvent('seeked')   // RESOLVES INSTANTLY — may be from pre-seek
  4. await player.waitForEvent('playing')  // RESOLVES INSTANTLY — from step 1
  5. seekLatency = ~0ms                    // WRONG

The measured latency is the time between Date.now() on step 2 and the
nearly-instant resolution of steps 3+4 — effectively 0-10ms.

## Fix: flush relevant events before the action

  // Before seek:
  await page.evaluate(() => {
    window.__qa.events = (window.__qa.events as string[]).filter(
      (e) => e !== 'seeking' && e !== 'seeked' && e !== 'playing'
    )
  })

  const seekStart = Date.now()
  await player.seek(60)
  await player.waitForEvent('seeked', 10_000)
  await player.waitForEvent('playing', 10_000)
  const seekLatency = Date.now() - seekStart

## Other affected patterns

- pause() → play() sequences: 'playing' is already in array after autoplay
- error recovery tests: 'error' may be in array from a previous iteration
- Ad event sequences: 'adsStarted' stays in array across ad pod segments

## Systemic fix option (alternative)

Instead of includes(), waitForEvent() could use event COUNT:
  const countBefore = window.__qa.events.filter(e => e === name).length
  // after action:
  window.__qa.events.filter(e => e === name).length > countBefore

This would require adding a beforeCount parameter or a different API.
Changing waitForEvent() globally is risky — it would break tests that rely
on backfill events (which are added in harness index.html .then() block and
should be detectable by any subsequent waitForEvent call). Flush is safer
as an opt-in pattern.

## Lower-bound assertion to catch stale matches

Always add after timing-based measurements:
  expect(seekLatency, 'must be positive — 0ms indicates stale event match').toBeGreaterThan(10)
