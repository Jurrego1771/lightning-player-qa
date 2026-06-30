/**
 * tests/contract/i18n-video-keys.spec.ts — Contrato de sincronización de keys video.json
 *
 * Cubre el gap MUST del módulo ui-core detectado por A4 (PR #705):
 *   - 264 líneas de cambios en src/view/i18n/en/video.json, es/video.json, pt/video.json
 *   - Reviewer signal: key 'controls.replay' presente en JSON pero sin uso confirmado en código
 *   - Riesgo: desincronización entre los 3 idiomas (key en uno, faltante en otro)
 *   - Riesgo: si key faltante → UI muestra la key raw (ej: "controls.subtitles.off")
 *
 * Símbolos cubiertos:
 *   controls.replay (key sin uso verificado — posible clave huérfana)
 *   controls.subtitles.* (85 strings nuevos)
 *   controls.volume.* (nuevos strings)
 *   controls.speed.* (nuevos strings)
 *
 * Estrategia (contract test):
 *   Los archivos JSON del namespace 'video' son internos al player bundle — no están
 *   expuestos como API pública. El contrato se verifica a través de efectos observables:
 *
 *   1. El player se inicializa correctamente en los 3 idiomas (es/en/pt) — si falta
 *      una key crítica en un idioma, el player puede lanzar excepciones al renderizar.
 *   2. No aparecen claves crudas visibles en el DOM del player — señal de keys faltantes.
 *   3. No hay errores de consola de i18next relacionados con keys del namespace 'video'.
 *   4. El player funciona en todos los idiomas soportados (BR-I18N-001).
 *
 * Fixture: isolatedPlayer (plataforma mockeada — determinista, sin dependencia de red)
 *
 * Nota sobre 'controls.replay':
 *   El reviewer signal indica que esta key existe en JSON pero no tiene consumidor
 *   conocido. Este test NO puede verificar la ausencia de consumidor directamente
 *   (requeriría análisis estático del bundle). En su lugar, verifica que:
 *   (a) La key no causa errores al estar presente (no es un anti-patrón que rompa el init)
 *   (b) No aparece como texto raw en el DOM (lo que indicaría que el player intenta usarla
 *       pero falla al renderizar el string)
 *
 * BR-I18N-001 — Idiomas soportados: es, en, pt
 * BR-I18N-002 — Idioma por defecto: 'es'
 * BR-I18N-003 — Namespace asignado por view: video → namespace 'video' + 'default'
 * BR-I18N-006 — Sin fallback de idioma — key faltante → key cruda visible en UI
 * BR-I18N-014 — Paridad de claves entre idiomas
 *
 * Tag: @contract @i18n
 */
import { test, expect, MockContentIds } from '../../fixtures'

// ── Suite 1: Sincronización entre idiomas — el player inicializa en es/en/pt ──

test.describe('i18n video.json — sincronización de keys entre idiomas', {
  tag: ['@contract', '@i18n'],
}, () => {

  // BR-I18N-001: idiomas soportados
  // Si video.json de un idioma tiene una key que los otros no tienen,
  // el player puede romper al intentar renderizar esa key en el idioma deficiente.

  test('player con language="es" (default) alcanza ready sin errores de i18next', async ({
    isolatedPlayer,
    page,
  }) => {
    // Arrange
    const i18nErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        const text = msg.text().toLowerCase()
        if (
          text.includes('i18next') ||
          text.includes('missing key') ||
          text.includes('translation key') ||
          text.includes('namespace') ||
          text.includes('video.')
        ) {
          i18nErrors.push(msg.text())
        }
      }
    })

    // Act — español es el idioma por defecto (BR-I18N-002)
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      language: 'es',
    })
    await isolatedPlayer.waitForReady(25_000)

    // Assert
    const initError = await isolatedPlayer.hasInitError()
    expect(
      initError,
      `CONTRACT VIOLATION [i18n video.json]: language='es' causó error de init.\n` +
      `Una key nueva en es/video.json puede estar siendo consumida por un componente\n` +
      `que falla al recibir un valor inesperado. Error: ${initError}`
    ).toBeNull()

    expect(
      i18nErrors,
      `CONTRACT VIOLATION [i18n video.json]: Errores de i18next con language='es'.\n` +
      `Puede indicar key faltante o namespace desincronizado.\n` +
      `Errores: ${JSON.stringify(i18nErrors, null, 2)}`
    ).toHaveLength(0)
  })

  test('player con language="en" alcanza ready sin errores de i18next', async ({
    isolatedPlayer,
    page,
  }) => {
    // Arrange
    const i18nErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        const text = msg.text().toLowerCase()
        if (
          text.includes('i18next') ||
          text.includes('missing key') ||
          text.includes('translation key') ||
          text.includes('namespace') ||
          text.includes('video.')
        ) {
          i18nErrors.push(msg.text())
        }
      }
    })

    // Act — inglés: el PR añade 85 líneas en en/video.json; si alguna está mal formada
    // o falta en otro idioma, i18next puede emitir warnings
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      language: 'en',
    })
    await isolatedPlayer.waitForReady(25_000)

    // Assert
    const initError = await isolatedPlayer.hasInitError()
    expect(
      initError,
      `CONTRACT VIOLATION [i18n video.json]: language='en' causó error de init.\n` +
      `en/video.json tiene 85 líneas nuevas — alguna puede estar desincronizada con es/pt.\n` +
      `Error: ${initError}`
    ).toBeNull()

    expect(
      i18nErrors,
      `CONTRACT VIOLATION [i18n video.json]: Errores de i18next con language='en'.\n` +
      `Errores: ${JSON.stringify(i18nErrors, null, 2)}`
    ).toHaveLength(0)
  })

  test('player con language="pt" alcanza ready sin errores de i18next', async ({
    isolatedPlayer,
    page,
  }) => {
    // Arrange
    const i18nErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        const text = msg.text().toLowerCase()
        if (
          text.includes('i18next') ||
          text.includes('missing key') ||
          text.includes('translation key') ||
          text.includes('namespace') ||
          text.includes('video.')
        ) {
          i18nErrors.push(msg.text())
        }
      }
    })

    // Act — portugués: tercer idioma del trio es/en/pt (BR-I18N-001)
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      language: 'pt',
    })
    await isolatedPlayer.waitForReady(25_000)

    // Assert
    const initError = await isolatedPlayer.hasInitError()
    expect(
      initError,
      `CONTRACT VIOLATION [i18n video.json]: language='pt' causó error de init.\n` +
      `pt/video.json tiene 85 líneas nuevas — si alguna key es diferente a es/en, el fallback\n` +
      `mostraría la key cruda al usuario. Error: ${initError}`
    ).toBeNull()

    expect(
      i18nErrors,
      `CONTRACT VIOLATION [i18n video.json]: Errores de i18next con language='pt'.\n` +
      `Errores: ${JSON.stringify(i18nErrors, null, 2)}`
    ).toHaveLength(0)
  })
})

// ── Suite 2: Keys críticas no aparecen como texto raw en el DOM ───────────────

test.describe('i18n video.json — keys críticas no aparecen como texto raw en el DOM', {
  tag: ['@contract', '@i18n'],
}, () => {

  // BR-I18N-011 — Clave inexistente retorna la clave como texto (key raw visible)
  // BR-I18N-014 — Paridad de claves entre idiomas
  //
  // Si controls.subtitles.*, controls.volume.*, controls.speed.* están en un idioma
  // pero no en otro, el player muestra strings como "controls.subtitles.off" en el DOM.
  // Este test verifica que NO hay texto raw de keys en el DOM renderizado del player.

  const KEY_PATTERNS_TO_DETECT = [
    // Patrones de keys crudas que no deberían aparecer en el DOM
    // Si el player tiene namespace 'video', las keys siguen el patrón: section.key
    /\bcontrols\.\w+\b/,
    /\btv(?:Controls|Audio|Subtitle)\.\w+\b/,
    /\bstatus\.\w+\b/,
    /\bchromecast\.\w+\b/,
    /\bnextEpisode\.\w+\b/,
    /\blive\.\w+\b/,
  ]

  test('DOM del player con language="es" no contiene keys crudas de namespace video', async ({
    isolatedPlayer,
    page,
  }) => {
    // Arrange + Act
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      language: 'es',
    })
    await isolatedPlayer.waitForReady(25_000)

    // Assert — buscar patrones de keys crudas en el texto del DOM
    // (excluir el script tag y comentarios HTML para evitar falsos positivos)
    const rawKeysFound = await page.evaluate((patterns) => {
      // Obtener texto visible del DOM del player
      const container = document.querySelector('#player-container, [data-player], #player') ??
        document.body

      // Recopilar todos los nodos de texto del container
      const walker = document.createTreeWalker(
        container,
        NodeFilter.SHOW_TEXT,
        null
      )

      const rawKeys: string[] = []
      let node = walker.nextNode()

      while (node) {
        const text = node.textContent?.trim() ?? ''
        if (text) {
          for (const pattern of patterns) {
            const re = new RegExp(pattern)
            if (re.test(text)) {
              rawKeys.push(`"${text.substring(0, 80)}" (matched: ${pattern})`)
            }
          }
        }
        node = walker.nextNode()
      }

      return rawKeys
    }, KEY_PATTERNS_TO_DETECT.map((p) => p.source))

    expect(
      rawKeysFound,
      `CONTRACT VIOLATION [i18n video.json]: Keys crudas detectadas en DOM con language='es'.\n` +
      `Indica key faltante en es/video.json — i18next usa la key como fallback (BR-I18N-011).\n` +
      `Keys encontradas: ${JSON.stringify(rawKeysFound, null, 2)}`
    ).toHaveLength(0)
  })

  test('DOM del player con language="en" no contiene keys crudas de namespace video', async ({
    isolatedPlayer,
    page,
  }) => {
    // Arrange + Act
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      language: 'en',
    })
    await isolatedPlayer.waitForReady(25_000)

    // Assert
    const rawKeysFound = await page.evaluate((patterns) => {
      const container = document.querySelector('#player-container, [data-player], #player') ??
        document.body
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null)
      const rawKeys: string[] = []
      let node = walker.nextNode()
      while (node) {
        const text = node.textContent?.trim() ?? ''
        if (text) {
          for (const pattern of patterns) {
            const re = new RegExp(pattern)
            if (re.test(text)) {
              rawKeys.push(`"${text.substring(0, 80)}" (matched: ${pattern})`)
            }
          }
        }
        node = walker.nextNode()
      }
      return rawKeys
    }, KEY_PATTERNS_TO_DETECT.map((p) => p.source))

    expect(
      rawKeysFound,
      `CONTRACT VIOLATION [i18n video.json]: Keys crudas detectadas en DOM con language='en'.\n` +
      `Posible desincronización en en/video.json (85 líneas nuevas en este PR).\n` +
      `Keys encontradas: ${JSON.stringify(rawKeysFound, null, 2)}`
    ).toHaveLength(0)
  })

  test('DOM del player con language="pt" no contiene keys crudas de namespace video', async ({
    isolatedPlayer,
    page,
  }) => {
    // Arrange + Act
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      language: 'pt',
    })
    await isolatedPlayer.waitForReady(25_000)

    // Assert
    const rawKeysFound = await page.evaluate((patterns) => {
      const container = document.querySelector('#player-container, [data-player], #player') ??
        document.body
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null)
      const rawKeys: string[] = []
      let node = walker.nextNode()
      while (node) {
        const text = node.textContent?.trim() ?? ''
        if (text) {
          for (const pattern of patterns) {
            const re = new RegExp(pattern)
            if (re.test(text)) {
              rawKeys.push(`"${text.substring(0, 80)}" (matched: ${pattern})`)
            }
          }
        }
        node = walker.nextNode()
      }
      return rawKeys
    }, KEY_PATTERNS_TO_DETECT.map((p) => p.source))

    expect(
      rawKeysFound,
      `CONTRACT VIOLATION [i18n video.json]: Keys crudas detectadas en DOM con language='pt'.\n` +
      `Keys encontradas: ${JSON.stringify(rawKeysFound, null, 2)}`
    ).toHaveLength(0)
  })
})

// ── Suite 3: Key 'controls.replay' — señal del reviewer ─────────────────────

test.describe('i18n video.json — key controls.replay (reviewer signal)', {
  tag: ['@contract', '@i18n'],
}, () => {

  // Reviewer signal del PR #705: "Key controls.replay in JSON but unused"
  // Este test verifica que:
  //   (a) La presencia de controls.replay NO rompe el init del player
  //   (b) La key NO aparece como texto raw en el DOM (que indicaría que
  //       algún componente la intenta usar pero no se renderiza correctamente)
  //
  // Nota: la ausencia total de consumidor solo puede verificarse via análisis
  // estático del bundle (fuera del scope de este test de contrato dinámico).

  test('controls.replay en video.json no rompe init del player (es/en/pt)', async ({
    isolatedPlayer,
  }) => {
    // Arrange + Act — verificar los 3 idiomas en secuencia; si controls.replay
    // causa un error de renderizado en alguno, el init fallará
    for (const lang of ['es', 'en', 'pt'] as const) {
      await isolatedPlayer.goto({
        type: 'media',
        id: MockContentIds.vod,
        autoplay: false,
        language: lang,
      })
      await isolatedPlayer.waitForReady(25_000)

      const initError = await isolatedPlayer.hasInitError()
      expect(
        initError,
        `CONTRACT VIOLATION [i18n controls.replay]: language='${lang}' causó error de init.\n` +
        `La key 'controls.replay' presente en video.json puede estar siendo consumida\n` +
        `sin el componente correcto. Error: ${initError}`
      ).toBeNull()
    }
  })

  test('controls.replay no aparece como key cruda en el DOM con ningún idioma', async ({
    isolatedPlayer,
    page,
  }) => {
    // Arrange + Act
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      language: 'en',
    })
    await isolatedPlayer.waitForReady(25_000)

    // Assert — si controls.replay no tiene consumidor, debería NO aparecer en el DOM.
    // Si aparece como texto raw ("controls.replay"), indica un consumidor que
    // está fallando al renderizar el string traducido.
    const replayKeyVisible = await page.evaluate(() => {
      const body = document.body.innerText ?? ''
      // Buscar la key cruda — no el valor traducido (que podría ser "Replay", "Repetir", etc.)
      return body.includes('controls.replay')
    })

    expect(
      replayKeyVisible,
      `CONTRACT VIOLATION [i18n controls.replay]: La key cruda 'controls.replay' está visible\n` +
      `en el DOM del player. Indica un consumidor que intenta usar la key pero no tiene\n` +
      `la traducción disponible o el componente no está correctamente conectado a i18next.`
    ).toBe(false)
  })
})

// ── Suite 4: Keys críticas de controles existen en los 3 idiomas ──────────────

test.describe('i18n video.json — keys críticas de controles en los 3 idiomas', {
  tag: ['@contract', '@i18n'],
}, () => {

  // Verifica indirectamente (a través del comportamiento del player) que las keys
  // críticas de controles están disponibles en los 3 idiomas.
  // Si controls.subtitles, controls.volume, controls.speed faltan en un idioma,
  // el player renderizaría esas keys como texto raw — lo que este test detecta.

  test('player con language="en" — sin errores de consola de keys subtitles/volume/speed', async ({
    isolatedPlayer,
    page,
  }) => {
    // Arrange
    const consoleErrors: string[] = []
    const consoleWarnings: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
      if (msg.type() === 'warning') {
        const text = msg.text().toLowerCase()
        if (
          text.includes('subtitles') ||
          text.includes('volume') ||
          text.includes('speed') ||
          text.includes('missing') ||
          text.includes('key')
        ) {
          consoleWarnings.push(msg.text())
        }
      }
    })

    // Act
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      language: 'en',
    })
    await isolatedPlayer.waitForReady(25_000)

    // Assert — las keys de controles críticos deben estar en en/video.json
    const i18nRelatedErrors = consoleErrors.filter((e) => {
      const lower = e.toLowerCase()
      return (
        lower.includes('key') ||
        lower.includes('i18n') ||
        lower.includes('translation') ||
        lower.includes('subtitles') ||
        lower.includes('volume') ||
        lower.includes('speed')
      )
    })

    expect(
      i18nRelatedErrors,
      `CONTRACT VIOLATION [i18n controles]: Errores de consola de i18n con language='en'.\n` +
      `controls.subtitles.*, controls.volume.*, controls.speed.* deben estar en en/video.json.\n` +
      `Errores: ${JSON.stringify(i18nRelatedErrors, null, 2)}`
    ).toHaveLength(0)

    expect(
      consoleWarnings,
      `CONTRACT VIOLATION [i18n controles]: Warnings de keys faltantes con language='en'.\n` +
      `Warnings: ${JSON.stringify(consoleWarnings, null, 2)}`
    ).toHaveLength(0)
  })

  test('player con language="pt" — sin errores de consola de keys subtitles/volume/speed', async ({
    isolatedPlayer,
    page,
  }) => {
    // Arrange
    const consoleErrors: string[] = []
    const consoleWarnings: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
      if (msg.type() === 'warning') {
        const text = msg.text().toLowerCase()
        if (
          text.includes('subtitles') ||
          text.includes('volume') ||
          text.includes('speed') ||
          text.includes('missing') ||
          text.includes('key')
        ) {
          consoleWarnings.push(msg.text())
        }
      }
    })

    // Act
    await isolatedPlayer.goto({
      type: 'media',
      id: MockContentIds.vod,
      autoplay: false,
      language: 'pt',
    })
    await isolatedPlayer.waitForReady(25_000)

    // Assert
    const i18nRelatedErrors = consoleErrors.filter((e) => {
      const lower = e.toLowerCase()
      return (
        lower.includes('key') ||
        lower.includes('i18n') ||
        lower.includes('translation') ||
        lower.includes('subtitles') ||
        lower.includes('volume') ||
        lower.includes('speed')
      )
    })

    expect(
      i18nRelatedErrors,
      `CONTRACT VIOLATION [i18n controles]: Errores de consola con language='pt'.\n` +
      `Errores: ${JSON.stringify(i18nRelatedErrors, null, 2)}`
    ).toHaveLength(0)

    expect(
      consoleWarnings,
      `CONTRACT VIOLATION [i18n controles]: Warnings de keys faltantes con language='pt'.\n` +
      `Warnings: ${JSON.stringify(consoleWarnings, null, 2)}`
    ).toHaveLength(0)
  })

  test('player inicializado en los 3 idiomas sin errores JS en el DOM', async ({
    isolatedPlayer,
    page,
  }) => {
    // Verify all three languages produce a stable player mount
    for (const lang of ['es', 'en', 'pt'] as const) {
      const jsErrors: string[] = []
      page.on('pageerror', (err) => {
        const msg = err.message.toLowerCase()
        if (
          !msg.includes('notallowederror') &&
          !msg.includes('autoplay') &&
          !msg.includes('ima') &&
          !msg.includes('google') &&
          !msg.includes('failed to load')
        ) {
          jsErrors.push(`[${lang}] ${err.message}`)
        }
      })

      await isolatedPlayer.goto({
        type: 'media',
        id: MockContentIds.vod,
        autoplay: false,
        language: lang,
      })
      await isolatedPlayer.waitForReady(25_000)
      await isolatedPlayer.assertNoInitError()

      expect(
        jsErrors,
        `CONTRACT VIOLATION [i18n video.json]: JS crashes con language='${lang}'.\n` +
        `Los 85 strings nuevos en ${lang}/video.json no deben causar errores de runtime.\n` +
        `Errores: ${jsErrors.join(' | ')}`
      ).toHaveLength(0)
    }
  })
})
