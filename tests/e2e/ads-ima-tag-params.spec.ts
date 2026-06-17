/**
 * Verifica que el player envía parámetros correctos en peticiones IMA
 * a pubads.g.doubleclick.net.
 *
 * Contenido: ContentIds.vodWithImaAds — VMAP con pre-roll + mid-roll (cue=15s) + post-roll.
 * Verificado manualmente con Playwright MCP el 2026-05-26.
 *
 * COMPORTAMIENTO CONOCIDO DEL IMA SDK (VMAP):
 * vpmute se fija en el momento de requestAds() al cargar el player y no
 * cambia durante la sesión aunque el usuario mutee después. El mid-roll y
 * post-roll heredan el mismo vpmute que el pre-roll porque comparten los
 * parámetros de sesión del VMAP inicial. replaceAdTagParameters no tiene
 * efecto sobre sesiones VMAP ya iniciadas.
 */
import { test, expect, ContentIds } from '../../fixtures'

const EMBED = 'https://develop.mdstrm.com/embed'
const PUBADS = 'pubads.g.doubleclick.net/gampad/ads'

function captureAdRequests(page: import('@playwright/test').Page) {
  const requests: URLSearchParams[] = []
  page.on('request', (req) => {
    if (req.url().includes(PUBADS)) requests.push(new URL(req.url()).searchParams)
  })
  return requests
}

function waitForAdBreak(
  requests: URLSearchParams[],
  vpos: 'preroll' | 'midroll' | 'postroll',
  timeoutMs = 25_000,
): Promise<URLSearchParams> {
  return new Promise((resolve, reject) => {
    const check = setInterval(() => {
      const match = requests.find((p) => p.get('vpos') === vpos)
      if (match) { clearInterval(check); resolve(match) }
    }, 200)
    setTimeout(() => { clearInterval(check); reject(new Error(`Timeout esperando ${vpos}`)) }, timeoutMs)
  })
}

// @flaky: pega a pubads.g.doubleclick.net REAL → depende del fill de Google
// (no-determinista, no-fill intermitente en headless/CI). Excluido del gate diario.
test.describe('IMA ad tag parameters', { tag: ['@flaky'] }, () => {
  test.setTimeout(45_000)

  // El IMA SDK de Google no dispara requests en headless WebKit ni Firefox —
  // comportamiento conocido del SDK. Estos tests requieren Chromium.
  test.skip(({ browserName }) => browserName !== 'chromium', 'IMA SDK requiere Chromium')

  // ── vpmute (estado inicial) ───────────────────────────────────────────────

  test('vpmute=0 en pre-roll cuando player carga con volume=1', async ({ page }) => {
    const reqs = captureAdRequests(page)
    await page.goto(`${EMBED}/${ContentIds.vodWithImaAds}?autoplay=true&volume=1`)
    const params = await waitForAdBreak(reqs, 'preroll')
    expect(params.get('vpmute')).toBe('0')
  })

  test('vpmute=1 en pre-roll cuando player carga con volume=0', async ({ page }) => {
    const reqs = captureAdRequests(page)
    await page.goto(`${EMBED}/${ContentIds.vodWithImaAds}?autoplay=true&volume=0`)
    const params = await waitForAdBreak(reqs, 'preroll')
    expect(params.get('vpmute')).toBe('1')
  })

  test('vpmute=1 en pre-roll cuando browser fuerza muted autoplay', async ({ page }) => {
    const reqs = captureAdRequests(page)
    await page.goto(`${EMBED}/${ContentIds.vodWithImaAds}`)
    const params = await waitForAdBreak(reqs, 'preroll')
    expect(params.get('vpmute')).toBe('1')
  })

  // ── vpmute (mid-roll hereda estado de sesión) ─────────────────────────────

  test('vpmute=0 en mid-roll cuando sesión inició con volume=1', async ({ page }) => {
    test.setTimeout(90_000)
    const reqs = captureAdRequests(page)
    await page.goto(`${EMBED}/${ContentIds.vodWithImaAds}?autoplay=true&volume=1`)
    const params = await waitForAdBreak(reqs, 'midroll', 75_000)
    expect(params.get('vpmute')).toBe('0')
    expect(params.get('cue')).toBe('15000')
  })

  test('vpmute=1 en mid-roll cuando sesión inició con volume=0', async ({ page }) => {
    test.setTimeout(90_000)
    const reqs = captureAdRequests(page)
    await page.goto(`${EMBED}/${ContentIds.vodWithImaAds}?autoplay=true&volume=0`)
    const params = await waitForAdBreak(reqs, 'midroll', 75_000)
    expect(params.get('vpmute')).toBe('1')
  })

  // ── vpa ──────────────────────────────────────────────────────────────────

  test('vpa=auto en pre-roll con autoplay habilitado', async ({ page }) => {
    const reqs = captureAdRequests(page)
    await page.goto(`${EMBED}/${ContentIds.vodWithImaAds}?autoplay=true&volume=1`)
    const params = await waitForAdBreak(reqs, 'preroll')
    expect(params.get('vpa')).toBe('auto')
  })

  // ── vis ──────────────────────────────────────────────────────────────────

  test('vis=1 cuando el player está visible en el viewport', async ({ page }) => {
    const reqs = captureAdRequests(page)
    await page.goto(`${EMBED}/${ContentIds.vodWithImaAds}?autoplay=true&volume=1`)
    const params = await waitForAdBreak(reqs, 'preroll')
    expect(params.get('vis')).toBe('1')
  })

  // ── u_so ─────────────────────────────────────────────────────────────────

  test('u_so=l en viewport landscape', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    const reqs = captureAdRequests(page)
    await page.goto(`${EMBED}/${ContentIds.vodWithImaAds}?autoplay=true&volume=1`)
    const params = await waitForAdBreak(reqs, 'preroll')
    expect(params.get('u_so')).toBe('l')
  })

  test('u_so=p en viewport portrait', async ({ page }) => {
    await page.setViewportSize({ width: 720, height: 1280 })
    const reqs = captureAdRequests(page)
    await page.goto(`${EMBED}/${ContentIds.vodWithImaAds}?autoplay=true&volume=1`)
    const params = await waitForAdBreak(reqs, 'preroll')
    expect(params.get('u_so')).toBe('p')
  })
})
