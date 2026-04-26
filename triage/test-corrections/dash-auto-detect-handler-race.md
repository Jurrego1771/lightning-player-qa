---
spec: tests/e2e/dash-auto-detect.spec.ts
test: "URL con extensión .mpd: DashHandler se selecciona automáticamente"
status: defective-test
reported: 2026-04-26
---

## Failure observed

Test reads `player.handler` immediately after `waitForReady()` and gets empty string `""`.

Error message (from contract test with identical pattern):
```
CONTRACT VIOLATION: Auto-detect DASH por .mpd falló — handler incorrecto seleccionado
→ Handler actual: ''. Una URL .mpd debe seleccionar el DashHandler automáticamente.
expect(received).toMatch(/dash/)
Received string: ""
```

## Root cause (diagnosed this session)

`loadMSPlayer()` resolves after `_controlsReady` fires (Controls mounts, ~100ms poll in `src/controls/index.js:41`).  
The HLS/Dash handler is inside `React.lazy` + `React.Suspense` in `src/player/base.js`. It mounts **async** after the Promise resolves.

`waitForReady()` polls `window.__qa.ready === true`. The harness backfills this flag unconditionally in the `.then()` of `loadMSPlayer()` (harness/index.html:159) — before `React.Suspense` finishes loading the lazy chunk.

Result: `player.handler` delegates to `_handler.get('handler')`. When `_handler === null` (lazy chunk not yet mounted), `BasePlayer.get()` returns `null && ...` = falsy → getter returns `''`.

Call chain:
- `LightningPlayer.prototype.handler` (via `expose()` in `src/player/base.js:_exposeMethods()`)
- → `BasePlayer.get('handler')`
- → `this._handler && this._handler.get('handler')` 
- → `null && ...` = `null` → `undefined` → getter returns `''`

The `handler` string (`'html5/mse+dash'`) is only available **after** `_setInnerRef` fires on the DashHandler component mount.

## Fix applied this session

Added `await player.waitForEvent('loadedmetadata', 20_000)` after `waitForReady()` for tests that read `player.handler`.

- `loadedmetadata` is a real event from the handler (not backfilled in harness)
- It fires after handler mounts and the manifest is fetched
- Guarantees `_handler !== null` before reading `player.handler`

For tests using `expect.poll` on `initialized` (not `waitForReady`), used:
```ts
await expect.poll(
  () => player.page.evaluate(() => (window as any).__player?.handler ?? ''),
  { timeout: 15_000 }
).toMatch(/.+/)
```
This is network-free — `handler` string is set on `_setInnerRef` (component mount), before any stream data loads.

## Files modified this session

1. `tests/e2e/dash-auto-detect.spec.ts`
   - Removed `test.fixme(true, ...)` at describe level (feature already merged to develop)
   - Added `waitForEvent('loadedmetadata')` after `waitForReady()` in tests 1 and 4
   - Added `expect.poll(handler !== '')` before `getHandler()` in test 5

2. `tests/contract/player-api.spec.ts`
   - Added `waitForEvent('loadedmetadata')` in "propiedades requeridas existen con el tipo correcto"

3. `tests/contract/player-api-format-param.spec.ts`
   - Added `waitForEvent('loadedmetadata')` in test 6 (backward compat)
   - Added `expect.poll(handler !== '')` in test 4 (src .mpd auto-detect)

## Agent task

Verify the fix applied to `tests/e2e/dash-auto-detect.spec.ts` is correct and complete:

1. Read the current state of the file
2. Confirm `test.fixme` was removed from describe level
3. Confirm `waitForEvent('loadedmetadata', 20_000)` was added after `waitForReady` in:
   - Test "URL con extensión .mpd: DashHandler se selecciona automáticamente"
   - Test "auto-detect DASH: URL HLS (.m3u8) sigue usando HLS handler (sin regresión)"
4. Confirm `expect.poll(handler !== '')` was added in test "format=dash explícito + URL HLS"
5. Verify no other tests in the file have the same race (read `player.handler` without proper wait)
6. Check `tests/e2e/dash-playback.spec.ts` — it also reads `player.handler` after `waitForReady(30_000)` (line 117). Same race applies. Fix if needed.
7. If all looks correct and complete, delete this triage file.

## Context: player source

- Player repo: `D:\Dev\Repos\mediastream\lightning-player`
- `src/controls/index.js` — `_exposeMethods()` exposes `currentTime`, `paused`, `status`, `isPlayingAd`, `onNext`, `onPrev`
- `src/player/base.js` — `_exposeMethods()` exposes `volume`, `loop`, `playbackRate`, `level`, `src`, and read-only props including `handler`, `loop`, `ended`
- `src/controls/methods.js` — `expose()` uses `Object.defineProperty` on `LightningPlayer.prototype`
- `src/api/player.jsx` — `LightningPlayer` class; `loadMSPlayer()` resolves after `_controlsReady`
- `src/player/handler/hls/handler.js:512` — `get('handler')` returns `'html5/mse+hls'`
- `src/player/handler/dash/handler.js:307` — `get('handler')` returns `'html5/mse+dash'`
- `src/player/handler/native.js:353` — `get('handler')` returns `'html5/native'`
