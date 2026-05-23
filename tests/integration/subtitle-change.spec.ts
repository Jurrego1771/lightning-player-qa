/**
 * subtitle-change.spec.ts — Tests de integración para el evento subtitlechange
 *
 * Valida el guard introducido en src/view/video/atoms/subtitle.js:
 *   const previous = get(selectedSubAtom)
 *   set(selectedSubAtom, subtitle)
 *   if (!silent && subtitle !== previous) {
 *     internalEmitter.emit(Events._subtitlechange, subtitle ?? null)
 *   }
 *
 * Gaps MUST cubiertos:
 *   gap-001 — Contrato: subtitlechange emite con payload TextTrack al cambiar A→B via UI
 *   gap-002 — Guard: seleccionar el mismo track via UI NO emite subtitlechange la 2ª vez
 *
 * Gap-003 (null payload al desactivar) NO es testeable via web UI:
 *   setSelectedSubtitle(null) solo se llama desde TV skin (disableAllSubtitles en
 *   TVAudioSubtitleSidebar / TVBottomRight). El toggle On/Off del popover web usa
 *   toggleSubtitle() que muta el modo directamente SIN llamar al atom setter.
 *   → Ver test.fixme() al final del archivo.
 *
 * Contenido: ContentIds.vodWithSubtitles (69d3081d5493800312af8b6e)
 *   3 tracks: en-us, es-co, uk-ua — todos con el mismo ID (bug de datos de prueba).
 *   Se accede por índice, no por ID.
 *
 * UI flow para disparar subtitlechange:
 *   1. click button[aria-label="Subtitles"]  → abre el popover
 *   2. click .msp__accordion__btn            → expande la lista de tracks
 *   3. click .msp__accordion__inner-btn:nth-child(N) → llama setSelectedSubtitle(lang)
 *
 * Observabilidad: subtitlechange no está en ALL_EVENTS del harness.
 *   Inyectamos listener via page.evaluate() ANTES de la acción y acumulamos
 *   payloads en window.__qa_subtitle_events[].
 *
 * @tags @integration @subtitlechange
 */
import { test, expect, ContentIds } from '../../fixtures'
import type { Page } from '@playwright/test'

// ── Helpers de observabilidad ─────────────────────────────────────────────────

async function installSubtitleListener (page: Page): Promise<void> {
  await page.evaluate(() => {
    ;(window as any).__qa_subtitle_events = []
    if (!(window as any).__qa_subtitle_listener_installed) {
      ;(window as any).__qa_subtitle_listener_installed = true
      const p = (window as any).__player
      if (p && typeof p.on === 'function') {
        p.on('subtitlechange', (track: unknown) => {
          ;(window as any).__qa_subtitle_events.push(track == null ? null : track)
        })
      }
    }
  })
}

async function drainSubtitleEvents (
  page: Page
): Promise<Array<{ language: string; label: string; kind: string; mode: string } | null>> {
  return page.evaluate(() => {
    const events: unknown[] = (window as any).__qa_subtitle_events ?? []
    ;(window as any).__qa_subtitle_events = []
    return events.map((t: any) => {
      if (t == null) return null
      return {
        language: String(t.language ?? ''),
        label:    String(t.label    ?? ''),
        kind:     String(t.kind     ?? ''),
        mode:     String(t.mode     ?? ''),
      }
    })
  })
}

async function waitForSubtitleEvents (
  page: Page,
  count: number,
  timeout = 5_000
): Promise<Array<{ language: string; label: string; kind: string; mode: string } | null>> {
  const accumulated: Array<{ language: string; label: string; kind: string; mode: string } | null> = []
  await expect.poll(
    async () => {
      const batch = await drainSubtitleEvents(page)
      accumulated.push(...batch)
      return accumulated.length
    },
    { timeout, message: `Esperando ${count} evento(s) subtitlechange` }
  ).toBeGreaterThanOrEqual(count)
  return accumulated
}

// ── Helper de UI ──────────────────────────────────────────────────────────────

/**
 * Abre el popover de subtítulos y expande la lista de tracks.
 * Precondición: el player debe tener ≥2 tracks (renderiza el accordion).
 */
async function openSubtitleAccordion (page: Page): Promise<void> {
  await page.click('button[aria-label="Subtitles"]')
  await page.waitForSelector('.msp__subtitles-popover', { timeout: 5_000 })
  await page.click('.msp__accordion__btn')
  await page.waitForSelector('.msp__accordion__inner-btn', { timeout: 3_000 })
}

/**
 * Selecciona el track en la posición `index` (0-based) del accordion expandido.
 * Asume que el accordion ya está abierto (openSubtitleAccordion() fue llamado).
 */
async function clickTrackAtIndex (page: Page, index: number): Promise<void> {
  const buttons = page.locator('.msp__accordion__inner-btn')
  await buttons.nth(index).click()
}

// ── Shared init ───────────────────────────────────────────────────────────────

async function initWithSubtitles (player: import('../../fixtures').LightningPlayerPage): Promise<void> {
  await player.goto({ type: 'media', id: ContentIds.vodWithSubtitles, autoplay: false })
  await player.waitForReady(25_000)
  // El contenido tiene 3 tracks — no 5 (bug de datos de prueba: todos comparten el mismo ID)
  await player.waitForTextTracks(3, 15_000)
}

// ── gap-001: Contrato del evento subtitlechange ───────────────────────────────

test.describe('subtitlechange — contrato del evento (gap-001)', () => {

  test('subtitlechange se emite al seleccionar un track diferente via UI', async ({ player, page }) => {
    await initWithSubtitles(player)

    // El atom selectedSubAtom se inicializa a tracks[0] vía trackChangeAtomEffect.onChange.
    // Instalar listener y seleccionar tracks[1] (distinta referencia → evento debe emitir).
    await installSubtitleListener(page)
    await openSubtitleAccordion(page)
    await clickTrackAtIndex(page, 1)   // tracks[1] = es-co

    const events = await waitForSubtitleEvents(page, 1)
    expect(events).toHaveLength(1)
    expect(events[0], 'payload no debe ser null al activar un track diferente').not.toBeNull()
  })

  test('payload de subtitlechange contiene language, label, kind y mode del track activado', async ({ player, page }) => {
    await initWithSubtitles(player)
    await installSubtitleListener(page)
    await openSubtitleAccordion(page)
    await clickTrackAtIndex(page, 2)   // tracks[2] = uk-ua

    const events = await waitForSubtitleEvents(page, 1)
    expect(events).toHaveLength(1)

    const payload = events[0]
    expect(payload, 'payload no debe ser null').not.toBeNull()

    // language y label deben ser strings no vacíos (no validamos valor exacto:
    // el contenido de prueba tiene labels como "ecra%^$$" que son basura de datos)
    expect(typeof payload!.language).toBe('string')
    expect(payload!.language.length).toBeGreaterThan(0)
    expect(typeof payload!.label).toBe('string')
    expect(payload!.label.length).toBeGreaterThan(0)
    expect(payload!.kind).toBe('subtitles')
    expect(['showing', 'hidden']).toContain(payload!.mode)
  })
})

// ── gap-002: Guard — mismo track no emite dos veces ───────────────────────────

test.describe('subtitlechange — guard no-emit-on-same-track (gap-002)', () => {

  test('seleccionar el mismo track dos veces via UI NO emite la segunda vez', async ({ player, page }) => {
    await initWithSubtitles(player)

    // Primer click: tracks[1] (distinto de tracks[0] inicial) → debe emitir
    await installSubtitleListener(page)
    await openSubtitleAccordion(page)
    await clickTrackAtIndex(page, 1)
    await waitForSubtitleEvents(page, 1)   // consume la primera emisión

    // Resetear buffer
    await installSubtitleListener(page)

    // Segundo click: mismo tracks[1] → guard subtitle !== previous bloquea la emisión
    // El accordion sigue abierto después del primer click
    await clickTrackAtIndex(page, 1)

    await expect.poll(
      () => page.evaluate(() => ((window as any).__qa_subtitle_events ?? []).length),
      {
        timeout: 2_500,
        intervals: [200, 300, 500],
        message: 'subtitlechange NO debe emitirse al reseleccionar el mismo track',
      }
    ).toBe(0)
  })

  test('A→A→B: la emisión para B es correcta tras el guard en A', async ({ player, page }) => {
    await initWithSubtitles(player)

    // Paso 1: A (tracks[1]) → emite
    await installSubtitleListener(page)
    await openSubtitleAccordion(page)
    await clickTrackAtIndex(page, 1)
    await waitForSubtitleEvents(page, 1)

    // Paso 2: A de nuevo → guard bloquea
    await installSubtitleListener(page)
    await clickTrackAtIndex(page, 1)
    await expect.poll(
      () => page.evaluate(() => ((window as any).__qa_subtitle_events ?? []).length),
      { timeout: 1_500, intervals: [200, 300, 500] }
    ).toBe(0)

    // Paso 3: B (tracks[2]) → debe emitir correctamente
    await installSubtitleListener(page)
    await clickTrackAtIndex(page, 2)

    const events = await waitForSubtitleEvents(page, 1)
    expect(events).toHaveLength(1)
    expect(events[0], 'payload de B no debe ser null').not.toBeNull()
    expect(events[0]!.language, 'debe ser el language del tercer track (uk-ua)').toBe('uk-ua')
  })
})

// ── gap-003: Null payload al desactivar (fixme) ───────────────────────────────

test.describe('subtitlechange — null payload al desactivar (gap-003)', () => {

  test.fixme(
    'subtitlechange emite null al desactivar el track activo',
    async () => {
      /**
       * NO IMPLEMENTABLE via web UI:
       *
       * setSelectedSubtitle(null) — la única llamada que emitiría subtitlechange con
       * payload null — solo existe en el TV skin:
       *   - TVAudioSubtitleSidebar: disableAllSubtitles(..., setSelectedSubtitle)
       *   - TVBottomRight: disableAllSubtitles(..., setSelectedSubtitle)
       *
       * El botón On/Off del popover web llama a toggleSubtitle() que muta
       * track.mode directamente sin pasar por el atom setter.
       *
       * Para testear esto se requiere:
       *   a) Cargar el player con type=media y TV skin habilitada, o
       *   b) Exponer player.selectSubtitle(null) en la API pública.
       *
       * Pendiente de: https://github.com/mediastream/lightning-player/issues/647
       */
    }
  )

  test.fixme(
    'desactivar un track ya disabled NO emite subtitlechange (previous === null)',
    async () => {
      // Misma limitación que el test anterior — no hay code path en web UI
      // que llame setSelectedSubtitle(null) para llegar al estado null→null.
    }
  )
})
