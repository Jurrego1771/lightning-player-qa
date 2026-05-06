---
name: Triage — System73 HLS integration tests
description: 3 failures all ENVIRONMENT (wrong player build); secondary defect: loadConfig rest-spread trap for peering config
type: project
---

# System73 HLS integration triage — 2026-05-06

## What happened

3 tests in `tests/integration/system73-hls.spec.ts` failed. Test 1 (path deshabilitado) passed.

## Root cause: ENVIRONMENT — wrong player build

The locally checked-out player is on `feature/issue-662`, not `feature/system73`. The `feature/system73` branch exists only as a remote (`origin/feature/system73`). The Playwright harness serves the bundle from the checked-out branch, which has NO System73 code:
- No `getSystem73HlsSDK.js` import
- No `this._s73Wrapper` field
- No `wrapPlayerConfig()` / `wrapPlayer()` calls in `_load()`
- No `_s73Wrapper.destroy()` in `componentWillUnmount`

All three failures are consequential: the mock `window.S73HlsjsWrapper` is injected correctly but the player never consults it.

**Fix:** `git checkout feature/system73` (after fetching) and rebuild the player bundle before running these tests.

## Secondary defect: loadConfig rest-spread trap (TEST DEFECT — independent of build)

`mockContentConfig(page, { metadata: { peering: { system73: {...} } } })` is wrong.

`loadConfig.js` line ~226 destructs the content config response and collects all unknown fields via rest-spread into `context.metadata`. The field `metadata` is not in the destructured list, so it lands at `context.metadata.metadata.peering.system73` — not `context.metadata.peering.system73` where the handler looks.

**Correct override:**
```js
await mockContentConfig(page, {
  peering: {
    system73: { enabled: true, key: 'mock-s73-key', hls: 'http://localhost:9001/mock-s73-sdk.js' }
  }
})
```

`peering` is also unknown to loadConfig → goes through rest-spread → lands at `context.metadata.peering.system73` ✓

This affects tests 2, 3, 4, 5, 6. Even if the correct player build were running, these tests would fail with the peering config unreachable.

## New pattern discovered

The loadConfig rest-spread trap: wrapping content config fields in a `metadata: {}` key adds one extra nesting level. This is a NEW variant of the mockcontent-config-path-mismatch pattern (which previously documented analytics plugin paths). Updated patterns/mockcontent-config-path-mismatch.md to cover this.

## Correction docs created

- `triage/test-corrections/2026-05-06_system73-environment-wrong-player-build.json`
- `triage/test-corrections/2026-05-06_system73-mockcontent-metadata-path.json`
