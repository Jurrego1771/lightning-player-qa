---
name: Player init requires platform content ID — src-only causes 404
description: All player fixture tests must use id: ContentIds.*, not src: Streams.*. Confirmed by live test failure: page snapshot showed "[harness] Error en loadMSPlayer: Request failed with status code 404".
type: feedback
---

The Lightning Player always makes a request to `develop.mdstrm.com/{type}/{id}.json` during initialization, even when `src` is provided without `id`. Without a valid ID, the response is 404 and `loadMSPlayer()` rejects, leaving `__qa.initialized` unset forever.

**Why:** The player's initialization architecture requires a platform content config before loading the stream. `src` is not a bypass — it is only used for the stream URL within the content config response. Direct `src`-only init via the harness is not supported by the Lightning Player's `loadMSPlayer()` API.

**How to apply:** In performance, E2E, and smoke tests that use the `player` fixture, always use `id: ContentIds.*` with a real platform content ID. The `src` field in `InitConfig` is documented as "fallback — not documented as official init option" and is confirmed non-functional when used without `id`.

The `Streams.*` / `ExternalStreams.*` exports exist only for reference or future use cases — do not use them in `player.goto()` calls.
