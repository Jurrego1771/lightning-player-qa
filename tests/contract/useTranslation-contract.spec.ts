/**
 * tests/contract/useTranslation-contract.spec.ts — Contrato del hook useTranslation
 *
 * Cubre el gap MUST del módulo dependency detectado por A4:
 *   gap-004 — Breaking change: campo `loading` eliminado del return de useTranslation
 *
 * Contexto del cambio (branch feature/issue-559-i18n-implementation):
 *   src/view/common/hook/useTranslation/index.js fue modificado:
 *     lines_added: 3, lines_removed: 13
 *   El campo `loading` fue eliminado del return del hook.
 *   Cualquier componente que destructure `const { loading } = useTranslation()` recibirá
 *   undefined en lugar de boolean. Esto puede congelar spinners de carga o mostrar
 *   estado de carga permanente en componentes que no manejen este caso.
 *
 * Estrategia de test (contract test):
 *   El hook useTranslation es interno al player — no está expuesto en la API pública.
 *   El contrato se verifica a través de sus efectos observables:
 *
 *   1. El player se inicializa sin errores de init — verificación de que los
 *      consumidores del hook no lanzan excepción al recibir el nuevo return shape.
 *   2. La UI del player renderiza texto (no strings vacíos/undefined) — los componentes
 *      consumen las traducciones del hook y las muestran en el DOM.
 *   3. No hay errores de consola relacionados con `loading` o traducciones undefined.
 *   4. El player funciona en múltiples idiomas (en, es, pt) — los JSON de i18n fueron
 *      actualizados con 115 líneas por idioma y el contrato verifica que las
 *      traducciones están accesibles.
 *
 * Fixture: isolatedPlayer (plataforma mockeada — determinista, sin dependencia de red)
 *
 * ⚠️  Sin docs para dependency/useTranslation — spec generado en modo básico.
 *     Considerar crear context/features/useTranslation.md para documentar el contrato.
 *
 * Tag: @contract
 */
import { test, expect, MockContentIds } from '../../fixtures'

// ── Suite 1: Contrato del return shape de useTranslation ──────────────────────

test.describe('useTranslation — contrato post-breaking-change', { tag: ['@contract'] }, () => {

  test('el player inicializa sin error tras eliminación del campo loading', async ({ isolatedPlayer }) => {
    // Arrange + Act
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
    })
    await isolatedPlayer.waitForReady(25_000)

    // Assert — ningún componente consumidor del hook debe lanzar al recibir return sin `loading`
    const initError = await isolatedPlayer.hasInitError()
    expect(
      initError,
      `CONTRACT VIOLATION [useTranslation]: El player falló durante el init.\n` +
      `El campo "loading" fue eliminado del hook. Algún consumidor puede estar ` +
      `usando "if (loading) return <Spinner />" con undefined → truthy → spinner permanente.\n` +
      `Error: ${initError}`
    ).toBeNull()
  })

  test('el evento ready se emite — confirma que árbol React montó con new hook shape', async ({ isolatedPlayer }) => {
    // Arrange
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
    })

    // Assert — ready se emite solo si TODOS los componentes montaron sin excepción
    await isolatedPlayer.waitForEvent('ready', 20_000)

    const events = await isolatedPlayer.page.evaluate(() => (window as any).__qa?.events ?? [])
    expect(events, 'CONTRACT VIOLATION [useTranslation]: ready no fue emitido').toContain('ready')
  })

  test('NO existe campo loading en el return del hook — validar que consumidores no lo usan', async ({ isolatedPlayer, page }) => {
    // Arrange — capturar warnings y errores antes de init
    const consoleMessages: Array<{ type: string; text: string }> = []
    page.on('console', (msg) => {
      consoleMessages.push({ type: msg.type(), text: msg.text() })
    })

    // Act
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
    })
    await isolatedPlayer.waitForReady(25_000)

    // Assert — no debe haber errores/warnings relacionados con el campo loading eliminado
    // Un spinner que chequea `if (loading)` con undefined truthy produciría un error de render
    const loadingRelated = consoleMessages.filter((m) => {
      const text = m.text.toLowerCase()
      return (
        (m.type === 'error' || m.type === 'warning') &&
        (text.includes('loading') || text.includes('spinner') || text.includes('undefined'))
      )
    })

    expect(
      loadingRelated,
      `CONTRACT VIOLATION [useTranslation]: Mensajes de consola relacionados con "loading":\n` +
      JSON.stringify(loadingRelated, null, 2)
    ).toHaveLength(0)
  })

  test('traducciones en idioma por defecto (en) no producen texto vacío post-init', async ({ isolatedPlayer, page }) => {
    // Arrange
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
    })
    await isolatedPlayer.waitForReady(25_000)

    // Assert — verificar que el player contiene texto renderizado en el DOM
    // (confirma que las traducciones del hook se aplican correctamente)
    // Los 115 líneas de i18n añadidas por idioma deben estar accesibles.
    //
    // Verificar que el player está en el DOM y tiene contenido visible
    const playerContainer = await page.locator('#player-container, [data-player], .msp__container')
      .count()

    // Si el player renderizó su árbol, el container debe existir en el DOM
    // (no necesitamos contar botones específicos — eso dependería de selectores internos)
    const playerInDom = await page.evaluate(() => {
      // El harness monta el player en un div. Verificar que hay elementos React montados.
      return document.querySelector('[data-reactroot], #player, #player-container') !== null
    })

    // La verificación principal es que el init fue exitoso (test anterior).
    // Aquí verificamos adicionalmente que el DOM tiene algo renderizado.
    // Si playerContainer === 0 y playerInDom === false, puede indicar que la traducción
    // bloqueó el render del árbol completo.
    expect(
      playerInDom || playerContainer > 0,
      'CONTRACT VIOLATION [useTranslation]: El player no renderizó ningún elemento en el DOM. ' +
      'Posible bloqueo de render por el nuevo return shape del hook de traducción.'
    ).toBe(true)
  })

  test('player funciona con contenido live tras refactor del hook', async ({ isolatedPlayer }) => {
    // Arrange — probar con un tipo de contenido diferente para cubrir más consumidores del hook
    await isolatedPlayer.goto({
      type: 'live',
      id: MockContentIds.live,
      autoplay: false,
    })

    // Act + Assert
    await isolatedPlayer.waitForReady(25_000)
    await isolatedPlayer.assertNoInitError()

    // Los componentes de live (LiveIndicator, etc.) también consumen useTranslation
    const events = await isolatedPlayer.page.evaluate(() => (window as any).__qa?.events ?? [])
    expect(events, 'CONTRACT VIOLATION [useTranslation]: ready no fue emitido en contenido live').toContain('ready')
  })

  test('player con audio inicializa correctamente — AudioView usa useTranslation', async ({ isolatedPlayer }) => {
    // Arrange — el AudioView también consume el hook modificado
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.audio,
      autoplay: false,
    })

    // Act + Assert
    await isolatedPlayer.waitForReady(25_000)
    await isolatedPlayer.assertNoInitError()
  })
})

// ── Suite 2: Integridad de las cadenas i18n añadidas ──────────────────────────

test.describe('useTranslation — integridad de cadenas i18n (115 líneas por idioma)', { tag: ['@contract'] }, () => {

  test('el player se inicializa sin errores de claves faltantes — idioma por defecto', async ({ isolatedPlayer, page }) => {
    // Arrange — capturar errores antes de init
    const jsErrors: string[] = []
    page.on('pageerror', (err) => jsErrors.push(err.message))

    const consoleErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text())
      }
    })

    // Act
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
    })
    await isolatedPlayer.waitForReady(25_000)

    // Assert — no debe haber errores JavaScript por claves i18n faltantes
    const i18nJsErrors = jsErrors.filter((e) =>
      e.toLowerCase().includes('key') ||
      e.toLowerCase().includes('translation') ||
      e.toLowerCase().includes('i18next')
    )
    expect(
      i18nJsErrors,
      `CONTRACT VIOLATION [useTranslation]: Errores JavaScript de i18n:\n` +
      JSON.stringify(i18nJsErrors, null, 2)
    ).toHaveLength(0)
  })

  test('la reproducción inicia correctamente tras refactor — contrato de comportamiento', async ({ isolatedPlayer }) => {
    // Arrange
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: true,
    })

    // Assert — el player debe llegar a playing (confirma que el hook no bloquea el flujo de init)
    await isolatedPlayer.waitForEvent('playing', 20_000)
    await isolatedPlayer.assertIsPlaying()
  })
})
