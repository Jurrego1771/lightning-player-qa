---
name: Youbora Integration Triage — 2026-04-28
description: 23 tests, 16 fail / 7 pass. All 16 failures are test defects from a single root cause.
type: project
---

# Youbora Integration Triage — 2026-04-28

## What happened

All 16 failing tests share a single root cause: `YOUBORA_CONFIG` uses the wrong JSON path for `mockPlayerConfig`.

### Wrong (spec uses this):
```js
const YOUBORA_CONFIG = {
  tracking: {
    youbora: { enabled: true, account_code: YOUBORA_ACCOUNT_CODE },
  },
}
```

### Correct:
```js
const YOUBORA_CONFIG = {
  metadata: {
    player: {
      tracking: {
        youbora: { enabled: true, account_code: YOUBORA_ACCOUNT_CODE },
      },
    },
  },
}
```

## Why

`mockPlayerConfig()` merges overrides into the raw player config response body. `api.js` then merges this body at the top level of `finalConfig` (so `finalConfig.tracking.youbora` is set). But `plugins/index.js:34` reads:

```js
const { enabled: youboraEnabled } = options?.metadata?.player?.tracking?.youbora || {}
```

`options.metadata.player` comes from the **content config** response (`vod.json`), which only has `{ type: 'video' }` — no `tracking` key. So `isYouboraEnabled = false` and Youbora never mounts.

Note: Comscore has a dual-path fallback (`|| options?.tracking?.comscore`) but Youbora does NOT.

## Verification from player source

- `src/plugins/index.js:34`: Youbora reads only `options?.metadata?.player?.tracking?.youbora`
- `src/analytics/youbora/index.jsx`: reads `context.options?.metadata?.player?.tracking?.youbora?.account_code`
- `src/api/api.js:165`: `finalConfig = merge({}, config, __config)` — player config body at root, content config at `metadata`
- `fixtures/platform-responses/content/vod.json`: `metadata.player = { type: 'video' }` only

## False positives in passing tests

Tests that expect 0 beacons and pass for the WRONG reason (Youbora never mounts due to wrong config path):
- TB-08: destroy before contentFirstPlay
- GAP-1: enabled=false explicitly
- GAP-2b: no fireStart before contentFirstPlay (autoplay=false)
- GAP-5: _pendingInit on destroy

## NPAW SDK domain

The SDK (`npaw-plugin@7.3.28`) uses `https://lma.npaw.com/{service}?...` as the beacon URL. The glob patterns `**/*.npaw.com/**` and `**/*.youbora.com/**` in `setupNpawInterceptor` are correct and would capture these if Youbora were active.

## Secondary defect in NPAW-7.1

The `video ended emits stop beacon` test has an additional issue: if `player.duration = 0`, `seekTarget = 9999`, and the `ended` event may never fire (seek beyond stream). This is secondary to the main root cause.

## Pending

The spec comment at lines 37-46 of `youbora.spec.ts` explicitly claims `tracking.youbora` is the correct path. This comment is wrong and should be corrected along with the `YOUBORA_CONFIG` constant.
