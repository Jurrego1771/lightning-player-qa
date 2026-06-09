# Acceptance Criteria — Lightning Player QA

Global QA standards. A test that violates MUST rules is rejected from the suite.

---

## MUST — Test is rejected if violated

- Import ALWAYS from `../../fixtures` — NEVER from `@playwright/test` directly
- No `waitForTimeout()` — use `waitForEvent()` or `expect.poll()`
- No internal CSS selectors: `.msp-*`, `.MediastreamPlayer`, `.lightning-*`
- Each test must be fully independent (no shared state between tests)
- `npx playwright test --list` must pass without TypeScript errors before a spec is considered complete
- No accessing player bundle internals (no `window.__hlsInstance`, no React internals)
- `page.route()` interceptors MUST be registered BEFORE `isolatedPlayer.goto()`

## NEVER

```typescript
import { test } from '@playwright/test'                // use fixtures/
page.waitForTimeout(N)                                 // use waitForEvent or poll
page.$('.msp-player-container')                        // internal selector
await page.evaluate(() => window.__playerInternal)     // internal access
```

---

## Approved Patterns

### Integration test — event assertion

```typescript
test('emite adsStarted cuando IMA carga VAST', async ({ isolatedPlayer, page }) => {
  const events: string[] = []
  await page.exposeFunction('__captureEvent', (name: string) => events.push(name))

  await isolatedPlayer.goto({
    type: 'vod',
    id: MockContentIds.vodWithAds,
    config: { ads: { map: 'https://mock-vast/preroll' } }
  })
  await isolatedPlayer.waitForEvent('ready', 15_000)
  await isolatedPlayer.play()

  await expect.poll(
    () => events.includes('adsStarted'),
    { timeout: 10_000, message: 'adsStarted no fue emitido' }
  ).toBe(true)
})
```

### Beacon interception — ALWAYS route before goto

```typescript
const beacons: string[] = []
await page.route(/tracking\.example\.com/, async (route) => {
  beacons.push(route.request().url())
  await route.fulfill({ status: 200, body: '' })
})
await isolatedPlayer.goto({ ... })
// then verify beacons after playback
```

### Event ordering assertion

```typescript
const received: string[] = []
for (const ev of ['adsStarted', 'adsFirstQuartile', 'adsMidpoint', 'adsThirdQuartile', 'adsComplete']) {
  player.on(ev, () => received.push(ev))
}
// ... play through ad ...
expect(received).toEqual(['adsStarted', 'adsFirstQuartile', 'adsMidpoint', 'adsThirdQuartile', 'adsComplete'])
```

---

## Minimum Coverage by Module Type

| Module type | Minimum coverage |
|-------------|-----------------|
| API pública (`controls-api`, `api-bootstrap`) | All MUST ACs + contract tests for method signatures |
| Ad systems (`ima`, `sgai`, `dai`) | Happy path lifecycle + VAST error case + beacon tracking |
| Playback (`hls`, `dash`) | VOD + Live + error recovery. DVR if applicable. |
| DRM | Only CI-testable (see `behavior.json ci_testable`). No FairPlay in CI. |
| UI modules | Visual regression + a11y. No functional tests. |
| Analytics | Beacon presence + URL pattern only. No internal structure. |
| Constants | Contract test: value of each Events.* constant matches expected string. |

---

## MUST / SHOULD / NICE Definitions (for coverage-auditor)

| Priority | When assigned |
|----------|--------------|
| **MUST** | AC with `priority: MUST` in module with criticality `critical` or `high`, with no existing coverage (`covered_by` empty) |
| **SHOULD** | AC with `priority: SHOULD`, or any AC in module with criticality `medium`, or AC with partial coverage |
| **NICE** | AC in module with criticality `low`, or additional edge case in already-covered module |

---

## Coverage Ratio Targets

| Module criticality | Target `test_coverage_ratio` |
|--------------------|------------------------------|
| critical | ≥ 0.80 |
| high | ≥ 0.60 |
| medium | ≥ 0.30 |
| low | no target |
