/**
 * text-tracks.spec.ts — Tests de la API de Subtítulos (TextTrackList)
 *
 * Contenido: `vodWithSubtitles` (69d3081d5493800312af8b6e)
 * Tracks disponibles (verificado en DEV):
 *   - Russian    (ru-ru)
 *   - French     (fr-fr)
 *   - Italian    (it-it)
 *   - Español    (es-co)
 *   - base       (es-cl)
 *
 * API cubierta:
 *   player.textTracks              — TextTrackList
 *   player.textTracks.length       — cantidad de tracks
 *   player.textTracks[i]           — acceso por índice
 *   player.textTracks.getTrackById — acceso por ID (URL del .vtt)
 *   track.id / kind / label / language / mode
 *   track.mode = 'showing'         — activar subtítulo
 *   track.mode = 'disabled'        — desactivar subtítulo
 *   evento texttrackchange         — disparo al cambiar modo
 */
import { test, expect, ContentIds } from '../../fixtures'

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Activa un track por idioma (BCP-47) y devuelve el track activado.
 * Retorna null si el idioma no existe en la lista.
 */
async function activateTrackByLanguage(
  page: import('@playwright/test').Page,
  language: string
): Promise<{ id: string; label: string; language: string; mode: string } | null> {
  return page.evaluate((lang) => {
    const tracks = (window as any).__player?.textTracks
    if (!tracks) return null
    for (let i = 0; i < tracks.length; i++) {
      if (tracks[i].language === lang) {
        tracks[i].mode = 'showing'
        return {
          id: tracks[i].id,
          label: tracks[i].label,
          language: tracks[i].language,
          mode: tracks[i].mode,
        }
      }
    }
    return null
  }, language)
}

// ── Fixture: inicializar una vez por bloque describe ──────────────────────────

test.describe('Text Tracks — Estructura e Inventario', () => {

  test('5 tracks disponibles en el contenido con subtítulos', async ({ player }) => {
    await player.goto({ type: 'media', id: ContentIds.vodWithSubtitles, autoplay: false })
    await player.waitForReady(20_000)
    await player.waitForTextTracks(5)

    const tracks = await player.getTextTracks()
    expect(tracks).toHaveLength(5)
  })

  test('todos los tracks son de kind "subtitles"', async ({ player }) => {
    await player.goto({ type: 'media', id: ContentIds.vodWithSubtitles, autoplay: false })
    await player.waitForReady(20_000)
    await player.waitForTextTracks(5)

    const tracks = await player.getTextTracks()
    for (const track of tracks) {
      expect(track.kind, `track "${track.label}" debe ser subtitles`).toBe('subtitles')
    }
  })

  test('todos los tracks inician en modo disabled', async ({ player }) => {
    await player.goto({ type: 'media', id: ContentIds.vodWithSubtitles, autoplay: false })
    await player.waitForReady(20_000)
    await player.waitForTextTracks(5)

    const tracks = await player.getTextTracks()
    for (const track of tracks) {
      expect(track.mode, `track "${track.label}" debe estar disabled`).toBe('disabled')
    }
  })

  test('cada track tiene id, label y language no vacíos', async ({ player }) => {
    await player.goto({ type: 'media', id: ContentIds.vodWithSubtitles, autoplay: false })
    await player.waitForReady(20_000)
    await player.waitForTextTracks(5)

    const tracks = await player.getTextTracks()
    for (const track of tracks) {
      expect(track.id, 'id no debe estar vacío').toBeTruthy()
      expect(track.label, 'label no debe estar vacío').toBeTruthy()
      expect(track.language, 'language no debe estar vacío').toBeTruthy()
    }
  })

  test('contiene tracks en los idiomas esperados', async ({ player }) => {
    await player.goto({ type: 'media', id: ContentIds.vodWithSubtitles, autoplay: false })
    await player.waitForReady(20_000)
    await player.waitForTextTracks(5)

    const tracks = await player.getTextTracks()
    const languages = tracks.map(t => t.language)

    expect(languages).toContain('ru-ru')  // Russian
    expect(languages).toContain('fr-fr')  // French
    expect(languages).toContain('it-it')  // Italian
    expect(languages).toContain('es-co')  // Español
    expect(languages).toContain('es-cl')  // base
  })

  test('las IDs de los tracks son URLs de archivos .vtt', async ({ player }) => {
    await player.goto({ type: 'media', id: ContentIds.vodWithSubtitles, autoplay: false })
    await player.waitForReady(20_000)
    await player.waitForTextTracks(5)

    const tracks = await player.getTextTracks()
    for (const track of tracks) {
      expect(track.id, `track "${track.label}" debe tener URL .vtt`).toMatch(/\.vtt$/)
    }
  })
})

// ── Activación de tracks ──────────────────────────────────────────────────────

test.describe('Text Tracks — Activación', () => {

  test('setTextTrackMode "showing" activa el track seleccionado', async ({ player }) => {
    await player.goto({ type: 'media', id: ContentIds.vodWithSubtitles, autoplay: false })
    await player.waitForReady(20_000)
    await player.waitForTextTracks(5)

    const tracks = await player.getTextTracks()
    const spanish = tracks.find(t => t.language === 'es-co')
    expect(spanish, 'track Español (es-co) debe existir').toBeTruthy()

    await player.setTextTrackMode(spanish!.id, 'showing')

    const updated = await player.getTextTracks()
    const updatedSpanish = updated.find(t => t.language === 'es-co')
    expect(updatedSpanish!.mode).toBe('showing')
  })

  test('activar un track desactiva los demás automáticamente', async ({ player }) => {
    await player.goto({ type: 'media', id: ContentIds.vodWithSubtitles, autoplay: false })
    await player.waitForReady(20_000)
    await player.waitForTextTracks(5)

    const tracks = await player.getTextTracks()
    const spanish = tracks.find(t => t.language === 'es-co')!
    await player.setTextTrackMode(spanish.id, 'showing')

    // Activar French — Español debe quedar disabled automáticamente
    const french = tracks.find(t => t.language === 'fr-fr')!
    await player.setTextTrackMode(french.id, 'showing')

    const updated = await player.getTextTracks()
    const activeCount = updated.filter(t => t.mode === 'showing').length
    expect(activeCount, 'solo un track puede estar showing').toBe(1)
    expect(updated.find(t => t.language === 'fr-fr')!.mode).toBe('showing')
  })

  test('setTextTrackMode "disabled" desactiva el track activo', async ({ player }) => {
    await player.goto({ type: 'media', id: ContentIds.vodWithSubtitles, autoplay: false })
    await player.waitForReady(20_000)
    await player.waitForTextTracks(5)

    const tracks = await player.getTextTracks()
    const italian = tracks.find(t => t.language === 'it-it')!
    await player.setTextTrackMode(italian.id, 'showing')

    let updated = await player.getTextTracks()
    expect(updated.find(t => t.language === 'it-it')!.mode).toBe('showing')

    await player.setTextTrackMode(italian.id, 'disabled')

    updated = await player.getTextTracks()
    expect(updated.find(t => t.language === 'it-it')!.mode).toBe('disabled')
    expect(updated.some(t => t.mode === 'showing')).toBe(false)
  })

  test('cambiar de un track a otro: secuencia completa', async ({ player }) => {
    await player.goto({ type: 'media', id: ContentIds.vodWithSubtitles, autoplay: false })
    await player.waitForReady(20_000)
    await player.waitForTextTracks(5)

    const tracks = await player.getTextTracks()
    const russian = tracks.find(t => t.language === 'ru-ru')!
    const french  = tracks.find(t => t.language === 'fr-fr')!

    // Paso 1: Russian
    await player.setTextTrackMode(russian.id, 'showing')
    let state = await player.getTextTracks()
    expect(state.find(t => t.language === 'ru-ru')!.mode).toBe('showing')

    // Paso 2: French — Russian debe quedar disabled
    await player.setTextTrackMode(french.id, 'showing')
    state = await player.getTextTracks()
    expect(state.find(t => t.language === 'fr-fr')!.mode).toBe('showing')
    expect(state.find(t => t.language === 'ru-ru')!.mode).not.toBe('showing')

    // Paso 3: desactivar todo
    await player.setTextTrackMode(french.id, 'disabled')
    state = await player.getTextTracks()
    expect(state.every(t => t.mode === 'disabled')).toBe(true)
  })

  test('activar cada track de la lista — todos son activables', async ({ player }) => {
    await player.goto({ type: 'media', id: ContentIds.vodWithSubtitles, autoplay: false })
    await player.waitForReady(20_000)
    await player.waitForTextTracks(5)

    const tracks = await player.getTextTracks()
    for (const track of tracks) {
      await player.setTextTrackMode(track.id, 'showing')
      const current = await player.getTextTracks()
      const active = current.find(t => t.id === track.id)
      expect(
        active!.mode,
        `track "${track.label}" (${track.language}) debe ser activable`
      ).toBe('showing')
    }
  })
})

// ── Eventos de tracks ─────────────────────────────────────────────────────────

test.describe('Text Tracks — Eventos', () => {

  test('texttrackchange se emite al activar un subtítulo', async ({ player, page }) => {
    await player.goto({ type: 'media', id: ContentIds.vodWithSubtitles, autoplay: false })
    await player.waitForReady(20_000)
    await player.waitForTextTracks(5)

    await page.evaluate(() => { (window as any).__qa.events = [] })

    const tracks = await player.getTextTracks()
    const spanish = tracks.find(t => t.language === 'es-co')!
    await player.setTextTrackMode(spanish.id, 'showing')

    await player.waitForEvent('texttrackchange', 5_000)
  })

  test('texttrackchange se emite al desactivar un subtítulo activo', async ({ player, page }) => {
    await player.goto({ type: 'media', id: ContentIds.vodWithSubtitles, autoplay: false })
    await player.waitForReady(20_000)
    await player.waitForTextTracks(5)

    const tracks = await player.getTextTracks()
    const french = tracks.find(t => t.language === 'fr-fr')!
    await player.setTextTrackMode(french.id, 'showing')
    await player.waitForEvent('texttrackchange', 5_000)

    await page.evaluate(() => { (window as any).__qa.events = [] })

    await player.setTextTrackMode(french.id, 'disabled')
    await player.waitForEvent('texttrackchange', 5_000)
  })

  test('texttrackchange se emite al cambiar de un track a otro', async ({ player, page }) => {
    await player.goto({ type: 'media', id: ContentIds.vodWithSubtitles, autoplay: false })
    await player.waitForReady(20_000)
    await player.waitForTextTracks(5)

    const tracks = await player.getTextTracks()
    const russian = tracks.find(t => t.language === 'ru-ru')!
    const italian = tracks.find(t => t.language === 'it-it')!

    await player.setTextTrackMode(russian.id, 'showing')
    await player.waitForEvent('texttrackchange', 5_000)

    await page.evaluate(() => { (window as any).__qa.events = [] })
    await player.setTextTrackMode(italian.id, 'showing')
    await player.waitForEvent('texttrackchange', 5_000)
  })
})

// ── Persistencia durante playback ─────────────────────────────────────────────

test.describe('Text Tracks — Persistencia durante Playback', () => {

  test('track activo persiste después de play() y pause()', async ({ player }) => {
    await player.goto({ type: 'media', id: ContentIds.vodWithSubtitles, autoplay: false })
    await player.waitForReady(20_000)
    await player.waitForTextTracks(5)

    // Activar Español
    const tracks = await player.getTextTracks()
    const spanish = tracks.find(t => t.language === 'es-co')!
    await player.setTextTrackMode(spanish.id, 'showing')

    // Reproducir y pausar
    await player.play()
    await player.waitForEvent('playing', 20_000)
    await player.pause()
    await player.assertIsPaused()

    // El track debe seguir activo
    const afterPause = await player.getTextTracks()
    expect(afterPause.find(t => t.language === 'es-co')!.mode).toBe('showing')
  })

  test('tracks siguen disponibles durante la reproducción', async ({ player }) => {
    await player.goto({ type: 'media', id: ContentIds.vodWithSubtitles, autoplay: true })
    await player.waitForEvent('playing', 25_000)

    const tracks = await player.getTextTracks()
    expect(tracks).toHaveLength(5)
    expect(tracks.every(t => t.kind === 'subtitles')).toBe(true)
  })

  test('activar track durante reproducción — modo se aplica inmediatamente', async ({ player }) => {
    await player.goto({ type: 'media', id: ContentIds.vodWithSubtitles, autoplay: true })
    await player.waitForEvent('playing', 25_000)
    await player.waitForTextTracks(5)

    const tracks = await player.getTextTracks()
    const french = tracks.find(t => t.language === 'fr-fr')!

    await player.setTextTrackMode(french.id, 'showing')

    const updated = await player.getTextTracks()
    expect(updated.find(t => t.language === 'fr-fr')!.mode).toBe('showing')
    expect(updated.find(t => t.language === 'fr-fr')!.mode).not.toBe('disabled')
  })
})

// ── Acceso a tracks específicos ───────────────────────────────────────────────

test.describe('Text Tracks — Acceso y Lectura', () => {

  test('getTextTracks() devuelve objetos con todas las propiedades requeridas', async ({ player }) => {
    await player.goto({ type: 'media', id: ContentIds.vodWithSubtitles, autoplay: false })
    await player.waitForReady(20_000)
    await player.waitForTextTracks(5)

    const tracks = await player.getTextTracks()

    for (const track of tracks) {
      expect(track).toHaveProperty('id')
      expect(track).toHaveProperty('kind')
      expect(track).toHaveProperty('label')
      expect(track).toHaveProperty('language')
      expect(track).toHaveProperty('mode')
      expect(['disabled', 'hidden', 'showing']).toContain(track.mode)
    }
  })

  test('labels coinciden con los idiomas esperados', async ({ player }) => {
    await player.goto({ type: 'media', id: ContentIds.vodWithSubtitles, autoplay: false })
    await player.waitForReady(20_000)
    await player.waitForTextTracks(5)

    const tracks = await player.getTextTracks()
    const byLang: Record<string, string> = {}
    for (const t of tracks) byLang[t.language] = t.label

    expect(byLang['ru-ru']).toBe('Russian')
    expect(byLang['fr-fr']).toBe('French')
    expect(byLang['it-it']).toBe('Italian')
    expect(byLang['es-co']).toBe('Español')
    expect(byLang['es-cl']).toBe('base')
  })
})
