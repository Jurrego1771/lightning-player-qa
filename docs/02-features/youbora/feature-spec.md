---
type: feature-spec
feature: youbora
version: "1.0"
status: draft
last_verified: 2026-04-28
---

# Feature Spec — Youbora (NPAW Analytics)

## What is Youbora / NPAW

Youbora is a video Quality of Experience (QoE) and analytics platform developed by NPAW (Nice People At Work). It collects real-time playback telemetry — startup time, buffering ratios, bitrate changes, errors, and ad lifecycle events — and sends them to the NPAW backend via HTTP beacons. The data is surfaced in the Youbora dashboard for content operators to monitor player performance and audience behavior. Integration is done via the official JavaScript SDK (`npaw-plugin`), which attaches to a player and fires structured beacons at defined lifecycle points.

---

## Integration into Lightning Player

### SDK

| Field | Value |
|---|---|
| Package | `npaw-plugin` |
| Version | `^7.3.28` (production dependency) |
| Import | `import NpawPlugin from 'npaw-plugin'` in `src/analytics/youbora/tracker.js` |

[CODE: package.json:139]
[CODE: src/analytics/youbora/tracker.js:1]

### Activation via platform config

Youbora is activated at runtime through the player config response (second HTTP request at player init, under `metadata.player.tracking.youbora`):

```json
{
  "metadata": {
    "player": {
      "tracking": {
        "youbora": {
          "enabled": true,
          "account_code": "ACCOUNT_CODE_STRING"
        }
      }
    }
  }
}
```

Both fields are required: `enabled` must be truthy (`true`, `1`, `'1'`, `'true'`) and `account_code` must be a non-empty string. If either is absent or falsy, the tracker does not initialize.

[CODE: src/plugins/index.js:34,41]
[CODE: src/analytics/youbora/tracker.js:57-59]

---

## Plugin class and mounting position

### Class hierarchy

```
Base (MediastreamBaseComponent — src/plugins/baseComponent.js)
  └── YouboraAnalytics  (src/analytics/youbora/index.jsx)
        └── YouboraTracker  (src/analytics/youbora/tracker.js)
```

`YouboraAnalytics` is a React class component that extends `Base`. It holds a single `YouboraTracker` instance and delegates lifecycle calls (`init`, `restart`, `destroy`) to it.

[CODE: src/analytics/youbora/index.jsx:5-27]

### Position in the plugin chain

`YouboraTracker` is registered as a lazy-loaded React component inside the `load()` function in `src/plugins/index.js`. It is added to the shared `components` map (alongside `StreamMetrics`, `ComscoreTracker`, `GoogleTracker`, etc.) only when `isYouboraEnabled` is true. The plugin host renders all components in this map as siblings — there is no defined render order dependency between them.

[CODE: src/plugins/index.js:13,60-62]

---

## Content types supported

| Player `type` | Youbora active | Notes |
|---|---|---|
| `media` | Yes (if config enabled) | Reported as `content.type = 'VOD'` |
| `episode` | Yes (if config enabled) | Reported as `content.type = 'VOD'`; season/show metadata added |
| `live` | Yes (if config enabled) | Reported as `content.type = 'Live'`; duration fixed at 0 |
| `dvr` | Yes (if config enabled) | Reported as `content.type = 'DVR'`; duration fixed at 0 |
| `audio` / `radio` / `podcast` | Yes (if config enabled) | Treated as VOD unless live/dvr |
| `reels` | Never | Plugin loader returns `{}` for reels — no plugins mount |

[CODE: src/plugins/index.js:27-31]
[CODE: src/analytics/youbora/tracker.js:8-12,23-26]

---

## What it tracks

### Content lifecycle

The tracker listens to player events and fires the corresponding NPAW adapter methods:

| Player event | Youbora action |
|---|---|
| `contentFirstPlay` | `fireStart()` + `fireJoin()` (once per session) |
| `playing` | `fireResume()` (only after first play and outside ad break) |
| `pause` | `firePause()` (only outside ad break) |
| `seeking` | `fireSeekBegin()` |
| `seeked` | `fireSeekEnd()` |
| `buffering` | `fireBufferBegin()` |
| `canplay` | `fireBufferEnd()` |
| `error` (fatal) | `fireFatalError()` |
| `error` (non-fatal) | `fireError()` |
| `ended` | `fireStop()` |

[CODE: src/analytics/youbora/tracker.js:84-120]

### Ads lifecycle

The tracker maintains a separate `adsAdapter` for ad break tracking:

| Player event | Youbora action |
|---|---|
| `adsStarted` | `adsAdapter.fireBreakStart()` (once per break) + `fireStart()` + `fireJoin()` |
| `adsComplete` | `adsAdapter.fireStop()` |
| `adsAllAdsCompleted` | `adsAdapter.fireBreakStop()` |
| `adsError` | `adsAdapter.fireError()` |
| `adsContentPauseRequested` | Sets `_inAdBreak = true`; fires content `firePause()` |
| `adsContentResumeRequested` | Sets `_inAdBreak = false`; fires content `fireResume()` |

During an active ad break (`_inAdBreak === true`), all content adapter events (playing, pause, seeking, seeked, buffering, canplay) are suppressed.

[CODE: src/analytics/youbora/tracker.js:122-175]
