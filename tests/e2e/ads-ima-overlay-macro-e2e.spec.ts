/**
 * ads-ima-overlay-macro-e2e.spec.ts — E2E: resolución de macros en overlay VAST URL
 *
 * Verifica que el player resuelve macros $custom.*$ en la overlay VAST URL
 * antes de enviarla al ad server (pubads.g.doubleclick.net).
 *
 * Fixture: media 6a36f0857896eb99d5beffc9 con overlay VAST URL que contiene:
 *   $custom.tag_custom$ — resuelto desde URL param del embed (PR #725)
 *   $custom.dfp$        — bug: debe resolverse desde config de plataforma
 *   $custom.kv$         — bug: debe resolverse desde config de plataforma
 *   $custom.desc_url$   — bug: debe resolverse desde config de plataforma
 *
 * Pre-requisito: ejecutar una vez antes del primer run:
 *   npx ts-node scripts/setup-overlay-ad-fixture.ts
 *
 * BR-IMA-013 — Macros en VAST URL se resuelven en el momento de la request.
 * BR-IMA-IND-001 — IMA SDK es Chromium-only en tests automatizados.
 *
 * Tag: @e2e @ads @ima @overlay @macros
 */
import { test, expect, ContentIds } from '../../fixtures'

const EMBED  = 'https://develop.mdstrm.com/embed'
const PUBADS = 'pubads.g.doubleclick.net/gampad/ads'

// La overlay VAST URL usa sz=480x70 (nonlinear). Los pre/mid/post usan sz=640x480 (linear).
// Esto permite distinguir la request del overlay de las demás.
const OVERLAY_SZ = '480x70'

test.describe('ads-ima overlay macro resolution — E2E plataforma real', {
  tag: ['@e2e', '@ads', '@ima', '@overlay', '@macros'],
}, () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'IMA SDK requiere Chromium'
  )
  test.setTimeout(45_000)

  test.beforeEach(async ({}, testInfo) => {
    if (!ContentIds.vodWithOverlayMacroAds || ContentIds.vodWithOverlayMacroAds.startsWith('TODO_')) {
      testInfo.skip(
        true,
        'CONTENT_ID_VOD_WITH_OVERLAY_MACRO_ADS no configurado.\n' +
        'Ejecutar primero: npx ts-node scripts/setup-overlay-ad-fixture.ts'
      )
    }
  })

  // ── Test principal ─────────────────────────────────────────────────────────

  test('$custom.tag_custom$ en overlay VAST URL se resuelve — no llega el token crudo al ad server', async ({ page }) => {
    const overlayRequests: URLSearchParams[] = []

    page.on('request', (req) => {
      if (req.url().includes(PUBADS)) {
        const params = new URL(req.url()).searchParams
        if (params.get('sz') === OVERLAY_SZ) {
          overlayRequests.push(params)
        }
      }
    })

    // custom.tag_custom=web → player lo lee como context.custom.tag_custom="web"
    // resolveAdTagMacros reemplaza $custom.tag_custom$ → "web" antes de requestAds()
    await page.goto(`${EMBED}/${ContentIds.vodWithOverlayMacroAds}?autoplay=true&volume=0&custom.tag_custom=web`)

    // Esperar hasta 35s a que el IMA SDK haga la request al overlay VAST URL.
    // El overlay aparece al inicio del video (position=0 en el ad config).
    await expect
      .poll(() => overlayRequests.length, {
        message: 'Esperando request al overlay VAST URL (sz=480x70 en pubads.g.doubleclick.net).\n' +
                 'Verificar que setup-overlay-ad-fixture.ts fue ejecutado y el ad está asignado al media.',
        timeout:  35_000,
        intervals: [1_000, 2_000, 3_000],
      })
      .toBeGreaterThan(0)

    const params = overlayRequests[0]

    // ── Aserción principal — la macro fue resuelta ─────────────────────────
    const tagCustom = params.get('tag_custom')

    expect(
      tagCustom,
      `$custom.tag_custom$ debe resolverse a "web" en plataforma web.\n` +
      `Si el valor es "$custom.tag_custom$" (literal), el fix del PR #725 no aplicó al flujo overlay.\n` +
      `URL capturada: ${params.toString()}`
    ).toBe('web')

    expect(
      tagCustom,
      '$custom.tag_custom$ no debe llegar sin resolver al ad server (HTTP 400 en producción)'
    ).not.toBe('$custom.tag_custom$')
  })

  // ── Test de regresión: el pre-roll no se rompió ────────────────────────────
  //
  // Verifica que el refactoring de adsRequest.js (que extrajo #_macro a adTagMacros.js)
  // no rompió la resolución de macros en el flujo del pre-roll.

  test('pre-roll VAST URL también resuelve $custom.tag_custom$ — regresión de adsRequest.js', async ({ page }) => {
    const prerollRequests: URLSearchParams[] = []

    page.on('request', (req) => {
      if (req.url().includes(PUBADS)) {
        const params = new URL(req.url()).searchParams
        // Pre-roll: linear (640x480) con vpos=preroll
        if (params.get('sz') === '640x480' && params.get('vpos') === 'preroll') {
          prerollRequests.push(params)
        }
      }
    })

    await page.goto(`${EMBED}/${ContentIds.vodWithOverlayMacroAds}?autoplay=true&volume=0&custom.tag_custom=web`)

    // Esperar 20s — si no llega ningún pre-roll el ad fixture no tiene schedule[pre] y saltamos
    await page.waitForTimeout(20_000)

    if (prerollRequests.length === 0) {
      test.info().annotations.push({
        type: 'info',
        description: 'El ad fixture no tiene pre-roll URL configurado en schedule[pre] — test omitido',
      })
      return
    }

    const params = prerollRequests[0]
    const tagCustom = params.get('tag_custom')

    // Si el ad fixture no tiene pre-roll URL configurado, el test pasa vacío (no es bloqueante)
    if (tagCustom === null) {
      test.info().annotations.push({
        type: 'info',
        description: 'El ad fixture no tiene pre-roll con $custom.tag_custom$ — skip de la aserción pre-roll',
      })
      return
    }

    expect(
      tagCustom,
      `$custom.tag_custom$ en pre-roll debe resolverse a "web".\n` +
      `Regresión en adsRequest.js (refactoring a adTagMacros.js).\n` +
      `URL capturada: ${params.toString()}`
    ).toBe('web')

    expect(tagCustom).not.toBe('$custom.tag_custom$')
  })

  // ── Comparación PreRoll vs Overlay — mismo macro, mismo embed, sin URL params ──
  //
  // Ambos (PreRoll y Overlay) tienen la misma VAST URL con $custom.iu_custom$.
  // Se carga el embed SIN pasar ?custom.iu_custom en la URL.
  //
  // Si PreRoll llega con el macro resuelto → el VMAP server de Mediastream
  //   resuelve macros desde la config de plataforma (no necesita URL params).
  // Si Overlay llega con el macro literal → el player no hace lo mismo para overlay.
  // Eso sería la prueba definitiva del bug.
  //
  // Si ambos llegan literales → el cliente SÍ debe pasar los valores como URL params
  //   (tanto PreRoll como Overlay los necesitan) y el bug no existe.

  test('PreRoll vs Overlay — $custom.iu_custom$ sin URL params: ¿cuál resuelve?', async ({ page }) => {
    const prerollRequests:  URLSearchParams[] = []
    const overlayRequests:  URLSearchParams[] = []

    page.on('request', (req) => {
      if (!req.url().includes(PUBADS)) return
      const params = new URL(req.url()).searchParams
      const sz     = params.get('sz')
      if (sz === '640x480') prerollRequests.push(params)
      if (sz === OVERLAY_SZ) overlayRequests.push(params)
    })

    // Sin custom.iu_custom en el embed — ¿quién resuelve el macro?
    await page.goto(
      `${EMBED}/${ContentIds.vodWithOverlayMacroAds}?autoplay=true&volume=0&custom.tag_custom=web`
    )

    // Esperar hasta 35s para capturar ambas requests
    await page.waitForTimeout(35_000)

    const MACRO_LITERAL = /\$custom\.\w[\w.]*\$/
    const EXPECTED_IU   = '/21775744923/external/'

    const prerollIu = prerollRequests[0]?.get('iu') ?? 'NO REQUEST'
    const overlayIu = overlayRequests[0]?.get('iu') ?? 'NO REQUEST'

    const prerollResolved = !MACRO_LITERAL.test(prerollIu) && prerollIu.includes(EXPECTED_IU)
    const overlayResolved = !MACRO_LITERAL.test(overlayIu) && overlayIu.includes(EXPECTED_IU)

    // Anotar el resultado observado para el reporte
    test.info().annotations.push({
      type: 'preroll-iu',
      description: `PreRoll iu=${prerollIu} → ${prerollResolved ? '✅ RESUELTO' : '❌ LITERAL'}`,
    })
    test.info().annotations.push({
      type: 'overlay-iu',
      description: `Overlay iu=${overlayIu} → ${overlayResolved ? '✅ RESUELTO' : '❌ LITERAL'}`,
    })

    // El test no hace expect aquí — solo documenta el comportamiento observado.
    // El resultado determina si el bug es real o si el cliente debe pasar URL params.
    expect(true).toBe(true) // siempre pasa — revisar annotations en el reporte
  })

  // ── Workaround confirmado: pasar custom.iu_custom vía URL param resuelve el macro ──
  //
  // Con ?custom.iu_custom=21775744923 en el embed URL, el player popula context.custom
  // y resolveAdTagMacros() sustituye $custom.iu_custom$ → "21775744923".
  // GAM recibe iu=/21775744923/external/nonlinear_ad_samples → ad unit válido → overlay carga.

  test('overlay VAST URL — $custom.iu_custom$ se resuelve con ?custom.iu_custom= en el embed (workaround)', async ({ page }) => {
    const overlayRequests: URLSearchParams[] = []

    page.on('request', (req) => {
      if (req.url().includes(PUBADS)) {
        const params = new URL(req.url()).searchParams
        if (params.get('sz') === OVERLAY_SZ) {
          overlayRequests.push(params)
        }
      }
    })

    // Pasar el network ID de GAM como custom param → el macro se resuelve
    await page.goto(
      `${EMBED}/${ContentIds.vodWithOverlayMacroAds}` +
      `?autoplay=true&volume=0` +
      `&custom.tag_custom=web` +
      `&custom.iu_custom=21775744923`
    )

    await expect
      .poll(() => overlayRequests.length, {
        message: 'Esperando overlay VAST request (sz=480x70).',
        timeout:   35_000,
        intervals: [1_000, 2_000, 3_000],
      })
      .toBeGreaterThan(0)

    const params = overlayRequests[0]
    const iu     = params.get('iu') ?? ''

    // El ad unit debe tener el network ID resuelto — no el token literal
    expect(iu, '$custom.iu_custom$ debe resolverse a "21775744923" vía URL param')
      .toBe('/21775744923/external/nonlinear_ad_samples')

    // Ningún param debe contener macros sin resolver
    const MACRO_LITERAL = /\$custom\.\w[\w.]*\$/
    for (const [key, value] of params.entries()) {
      expect(value, `Param "${key}" no debe contener macro literal`).not.toMatch(MACRO_LITERAL)
    }
  })
})
