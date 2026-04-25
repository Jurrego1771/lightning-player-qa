---
name: Events Spec Triage — 2026-04-24
description: Triage of tests/e2e/events.spec.ts — 9 of 10 tests structurally correct, 1 test defect (canplaythrough race condition)
type: project
---

# Events Spec Triage — 2026-04-24

## Context

User asked specifically whether events.spec.ts verifies loadstart → durationchange → loadedmetadata
ordering and whether the approach is correct. Full static triage performed on all 10 tests.

## Answers to the user's four specific questions

### Q1: Does the spec verify the order loadstart → durationchange → loadedmetadata?
YES. Test "los eventos de carga siguen el orden correcto" (line 34) verifies this explicitly:
- Flushes __qa.events
- Calls player.load() (which also flushes internally — the manual flush is redundant)
- Waits for player.waitForReady(35_000) — safe because ready only fires after loadedmetadata
- Snapshots the events array
- Checks indexOf(loadstart) < indexOf(durationchange) < indexOf(loadedmetadata)
The approach is structurally sound.

### Q2: Does window.__qa.events track loadstart and durationchange?
YES. Both are in the HTML5_EVENTS array in harness/index.html (line 70-75):
  var HTML5_EVENTS = [
    'abort', 'canplay', 'canplaythrough', 'durationchange', 'emptied',
    'ended', 'loadeddata', 'loadedmetadata', 'loadstart', ...
  ]
These are NOT invisible. They are tracked live via player.on() listeners registered
in the harness .then() callback.

### Q3: Would waitForEvent('loadedmetadata') work if the event already fired (stale match)?
Not applicable to this specific test — the spec (and then player.load() internally) flush
__qa.events before calling the player API load(), so loadedmetadata cannot be pre-existing
in the array. The stale match problem only applies to tests that DO NOT flush before waiting.

### Q4: Does the spec verify sequential ORDER or only presence?
It verifies ORDER via indexOf comparisons:
  expect(loadstartIdx).toBeLessThan(durationIdx)
  expect(durationIdx).toBeLessThan(metadataIdx)
It also verifies PRESENCE (>= 0) as a precondition. Full ordering check — correct.

## Findings per test

### 9 tests — CORRECT (no action required)

1. loadstart via load() — correct, redundant manual flush is harmless
2. loadstart → durationchange → loadedmetadata order — correct, structurally sound
3. seeking se emite — correct, flush before seek eliminates stale match
4. seeking precede a seeked — correct, wait for later event then check indices
5. volumechange al cambiar volume — correct
6. volumechange a 0 — correct
7. volumechange al restaurar — correct, flush between setVolume(0) and setVolume(1)
8. ratechange al cambiar — correct
9. ratechange al restaurar — correct, flush between rate=2 and rate=1

### 1 test — TEST DEFECT

"canplaythrough se emite durante reproducción de VOD" (line 64)
- Root cause: autoplay=true starts the player racing toward readyState=4 during init.
  canplaythrough can fire before harness .then() registers listeners. The backfill block
  does NOT cover canplaythrough (only covers canplay for readyState >= 3 or >= 1).
  If the race is lost, the test waits 25s and times out. Flaky on warm CDN.
- Fix: use autoplay=false, wait for ready, call play(), then wait for canplaythrough.
- Correction doc: triage/test-corrections/2026-04-24_canplaythrough-no-backfill-race.json

## Key architectural insight confirmed

The player.load() method in fixtures/player.ts already flushes __qa.events internally
(and sets __qa.ready = false) before calling the player API. Any test that manually
flushes before calling player.load() is doing redundant work — not wrong, but unnecessary.
This is a documentation gap worth noting to test authors.

## Harness backfill coverage map (confirmed from harness/index.html)

Backfilled:       play, playing, canplay, loadedmetadata (conditionally), loaded, metadataloaded, ready, error
NOT backfilled:   canplaythrough, loadstart, durationchange, seeking, seeked, volumechange, ratechange

Implication: any test that uses autoplay=true and then waitForEvent() for a non-backfilled
event is vulnerable to a race condition. The safe pattern is autoplay=false + explicit play().

## Classification summary

- REAL BUGS: 0
- TEST DEFECTS: 1 (canplaythrough race, correction doc created)
- FLAKY: 0 (canplaythrough defect is the cause of any flakiness in this test)
- ENVIRONMENT: 0
