---
name: canplaythrough Backfill Gap Pattern
description: harness/index.html does not backfill canplaythrough — tests using autoplay=true + waitForEvent('canplaythrough') are flaky on warm CDN hits
type: feedback
---

# canplaythrough Backfill Gap Pattern

## What the harness backfills (and what it does not)

The backfill block in harness/index.html (inside loadMSPlayer .then()) covers:
- play, playing — when player.status === 'playing' or !player.paused
- canplay — when player.readyState >= 3 or >= 1
- loadedmetadata — when player.readyState >= 1
- loaded, metadataloaded — unconditionally
- ready — unconditionally
- error — when player.status === 'error'

NOT backfilled:
- canplaythrough (readyState >= 4)
- loadstart, durationchange, seeking, seeked, volumechange, ratechange

**Why:** These events have no readyState-equivalent check in the backfill block.

## When this causes failures

Pattern that fails:
  await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: true })
  await player.waitForEvent('canplaythrough', 25_000)  // FLAKY

With autoplay=true and a warm CDN, the player can reach readyState=4 before
the harness .then() registers listeners. canplaythrough fires once and is gone.
No backfill catches it. waitForEvent polls indefinitely until timeout.

## Fix: use autoplay=false + explicit play()

  await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: false })
  await player.waitForReady()
  await player.play()
  await player.waitForEvent('canplaythrough', 25_000)

With autoplay=false, the player pauses at the ready state. Listeners are fully
registered before play() is called. canplaythrough will fire during active buffering,
AFTER listeners exist — no race possible.

**Why:** waitForReady() guarantees that the harness .then() has fully completed
(window.__qa.initialized === true), meaning all player.on() listeners are active.

## Scope: which events share this vulnerability

Any non-backfilled event that can fire during the init window with autoplay=true:
- canplaythrough — confirmed affected
- loadstart — NOT affected in practice (fires before readyState=1, before backfill gap opens)
- durationchange — same as loadstart, fires early in load cycle
- Events that only fire on explicit user action (seeking, volumechange, ratechange) — not affected

Practical rule: if a test uses autoplay=true and waits for canplaythrough, switch to
autoplay=false + waitForReady() + play(). Apply to any event that fires during the
HAVE_ENOUGH_DATA readyState transition.
