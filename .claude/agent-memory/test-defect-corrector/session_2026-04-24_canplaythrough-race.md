---
name: Test Corrections — canplaythrough race condition
description: Fixed canplaythrough race condition in events.spec.ts caused by autoplay=true racing ahead of harness listener registration
type: project
---

# Test Corrections — 2026-04-24

## Tests Fixed

- `tests/e2e/events.spec.ts` — timing_issue (harness listener registration race) — changed `autoplay: true` to `autoplay: false` + `waitForReady()` + `play()` before `waitForEvent('canplaythrough')`

## Root Cause

The harness (`harness/index.html`) registers player event listeners inside the `.then()` callback of `loadMSPlayer()`. With `autoplay: true` on a warm CDN, the player can reach `readyState=4` (HAVE_ENOUGH_DATA) and fire `canplaythrough` before the `.then()` executes and registers the listener. The harness backfill block only covers `canplay` (readyState >= 3 or >= 1) — `canplaythrough` (readyState >= 4) has no backfill guard. Once the race is lost, the event never fires again for that content load, causing the test to wait the full 25s before timing out.

## Fix Pattern

Use `autoplay: false` for any test that listens for early-lifecycle events (`canplaythrough`, `canplay`, `loadeddata`) — events that fire close to or during the initial buffering phase. Call `waitForReady()` first to guarantee listener registration is complete, then trigger playback explicitly with `play()`.

**Why:** `autoplay: false` keeps the player paused at ready state, giving the harness `.then()` time to complete listener registration before any buffering begins. The explicit `play()` call then triggers the buffering sequence with all listeners already in place.

## Negative Validation Method

Used a 500ms timeout on `waitForEvent('canplaythrough')` with `autoplay: true` and no `waitForReady`. This reliably fails even on warm CDN because the harness `.then()` does not complete in 500ms — the player initialization itself takes ~2-3s. Confirmed `TimeoutError` on both the run and its retry.

## Patterns Found

- `canplaythrough` is NOT in the harness backfill block — treat it like a one-shot event that must be listened for before it fires
- Any `waitForEvent()` on early-lifecycle events (before `playing`) requires `autoplay: false` + explicit `play()` to be race-free
- The 25s timeout on `waitForEvent('canplaythrough')` is appropriate for CDN cold-cache; the fix makes the race structurally impossible rather than relying on the timeout

## Pending

None.
