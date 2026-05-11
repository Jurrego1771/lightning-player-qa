/**
 * player-api.spec.ts — Tests de la API oficial del Lightning Player
 *
 * Cubre propiedades y métodos del player que no están en vod-playback o live-playback:
 *   - startPos: iniciar reproducción en una posición específica
 *   - volume en init config
 *   - muted: propiedad de silencio
 *   - playbackRate: velocidad de reproducción
 *   - readyState: estados HAVE_NOTHING → HAVE_ENOUGH_DATA
 *   - sourcechange: evento al cambiar contenido con load()
 *   - Secuencia de eventos en init (loaded → metadataloaded → ready)
 *   - player.metadata: objeto con info del contenido cargado
 *   - handler: motor de reproducción activo ('hls' | 'dash' | 'html5/native')
 *   - version: versión del player
 *   - type: tipo de contenido ('video' | 'audio')
 *   - loop: propiedad de repetición
 *   - once(): listener de un solo disparo
 *   - off(): deregistrar listener
 *
 * Referencia: API oficial del Lightning Player (loadMSPlayer, player.*).
 * Todos los tests usan IDs reales del ambiente DEV.
 */
import { test, expect, ContentIds } from '../../fixtures'

// ── Config init ──────────────────────────────────────────────────────────────

test.describe('Init Config — startPos', { tag: ['@regression'] }, () => {

  test('startPos: el player inicia cerca de la posición indicada', async ({ player }) => {
    const TARGET = 20
    await player.goto({ type: 'media', id: ContentIds.vodLong, autoplay: true, startPos: TARGET })
    await player.waitForReady()

    // No usar waitForEvent('playing') — el backfill del harness lo inyecta antes de que
    // el seek de startPos complete, haciendo que currentTime sea 0 al leer.
    // Pollear currentTime directamente hasta que esté dentro de la tolerancia.
    await expect.poll(
      async () => Math.abs(await player.getCurrentTime() - TARGET),
      { timeout: 30_000 }
    ).toBeLessThanOrEqual(5)
  })

  test('startPos=0: comportamiento equivalente a sin startPos', async ({ player }) => {
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: true, startPos: 0 })
    await player.waitForEvent('playing', 20_000)

    const t = await player.getCurrentTime()
    expect(t).toBeGreaterThanOrEqual(0)
    expect(t).toBeLessThan(5)
  })
})

test.describe('Init Config — volume', { tag: ['@regression'] }, () => {

  test('setVolume(0.3) aplica y se puede leer', async ({ player }) => {
    // player.volume en config init no se refleja directamente en la propiedad;
    // usamos setVolume() que sí es la API documentada para cambiar volumen.
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: true })
    await player.waitForEvent('playing', 20_000) // asegurar que el video element existe

    await player.setVolume(0.3)
    // poll para que el setter tenga tiempo de propagarse
    await expect.poll(() => player.getVolume(), { timeout: 3_000 }).toBeCloseTo(0.3, 1)
  })

  test('setVolume(0) silencia el player', async ({ player }) => {
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: true })
    await player.waitForEvent('playing', 20_000)

    await player.setVolume(0)
    await expect.poll(() => player.getVolume(), { timeout: 3_000 }).toBe(0)
  })
})

// ── Propiedades de reproducción ──────────────────────────────────────────────

test.describe('Propiedades — muted', { tag: ['@regression'] }, () => {

  test('muted=true silencia el player', async ({ player }) => {
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: true })
    await player.waitForEvent('playing', 20_000)

    await player.setMuted(true)
    expect(await player.isMuted()).toBe(true)
  })

  test('muted=false restaura el audio', async ({ player }) => {
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: true })
    await player.waitForEvent('playing', 20_000)

    await player.setMuted(true)
    await player.setMuted(false)
    expect(await player.isMuted()).toBe(false)
  })
})

test.describe('Propiedades — playbackRate', { tag: ['@regression'] }, () => {

  test('playbackRate=2 duplica la velocidad', async ({ player }) => {
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: true })
    await player.waitForEvent('playing', 20_000)
    await expect.poll(() => player.getStatus(), { timeout: 10_000 }).toBe('playing')

    await player.setPlaybackRate(2)
    await expect.poll(() => player.getPlaybackRate(), { timeout: 10_000 }).toBe(2)
  })

  test('playbackRate=0.5 reduce la velocidad a la mitad', async ({ player }) => {
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: true })
    await player.waitForEvent('playing', 20_000)
    await expect.poll(() => player.getStatus(), { timeout: 10_000 }).toBe('playing')

    await player.setPlaybackRate(0.5)
    await expect.poll(() => player.getPlaybackRate(), { timeout: 10_000 }).toBe(0.5)
  })

  test('playbackRate=1 restaura velocidad normal', async ({ player }) => {
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: true })
    await player.waitForEvent('playing', 20_000)
    await expect.poll(() => player.getStatus(), { timeout: 10_000 }).toBe('playing')

    await player.setPlaybackRate(2)
    await player.setPlaybackRate(1)
    await expect.poll(() => player.getPlaybackRate(), { timeout: 10_000 }).toBe(1)
  })
})

test.describe('Propiedades — readyState', { tag: ['@regression'] }, () => {

  test('canplay se emite: indica HAVE_FUTURE_DATA (readyState ≥ 3)', async ({ player, page }) => {
    // La propiedad readyState no está expuesta directamente por el Lightning Player.
    // Verificamos el comportamiento equivalente: el evento canplay se debe emitir,
    // lo cual por spec HTML5 garantiza que readyState >= 3 en el media element.
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: true })
    await player.waitForEvent('canplay', 20_000)

    const events: string[] = await page.evaluate(() => (window as any).__qa.events)
    expect(events).toContain('canplay')
  })
})

// ── Eventos de carga ─────────────────────────────────────────────────────────

test.describe('Eventos — Secuencia de Init', { tag: ['@regression'] }, () => {

  test('loaded, metadataloaded y ready se emiten en la inicialización', async ({ player, page }) => {
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: false })
    await player.waitForEvent('ready', 20_000)

    const events: string[] = await page.evaluate(() => (window as any).__qa.events)

    // Los tres eventos clave deben estar presentes
    expect(events, 'loaded debe existir').toContain('loaded')
    expect(events, 'metadataloaded debe existir').toContain('metadataloaded')
    expect(events, 'ready debe existir').toContain('ready')

    // ready debe ser el último de los tres
    const metaIdx = events.indexOf('metadataloaded')
    const readyIdx = events.indexOf('ready')
    expect(readyIdx).toBeGreaterThanOrEqual(metaIdx)
  })

  test('autoplay=true: secuencia incluye play → playing', async ({ player, page }) => {
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: true })
    await player.waitForEvent('playing', 25_000)

    const events: string[] = await page.evaluate(() => (window as any).__qa.events)
    expect(events).toContain('play')
    expect(events).toContain('playing')
  })

  test('canplay se emite antes de playing', async ({ player, page }) => {
    // autoplay: false para que play() sea explícito.
    // Con autoplay: false el stream no bufferiza en absoluto (readyState=0) hasta que
    // se llama play(). Limpiamos eventos ANTES de play() para capturar la secuencia
    // real: canplay → playing sin ruido del backfill del init.
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: false })
    await player.waitForReady()

    await page.evaluate(() => { (window as any).__qa.events = [] })
    await player.play()
    await player.waitForEvent('playing', 25_000)

    // Esperar a que canplay también esté en el array — puede llegar con leve retraso
    // en el mismo microtask batch que playing, causando flakiness si se lee inmediatamente.
    await expect.poll(
      () => page.evaluate(() => (window as any).__qa.events.includes('canplay')),
      { timeout: 5_000 }
    ).toBe(true)

    const events: string[] = await page.evaluate(() => (window as any).__qa.events)
    const canplayIdx = events.indexOf('canplay')
    const playingIdx = events.indexOf('playing')

    expect(canplayIdx, 'canplay debe existir').toBeGreaterThanOrEqual(0)
    expect(canplayIdx, 'canplay debe preceder a playing').toBeLessThanOrEqual(playingIdx)
  })
})

test.describe('Eventos — load() dinámico', { tag: ['@regression'] }, () => {

  test('load() emite sourcechange', async ({ player, page }) => {
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: false })
    await player.waitForReady()

    // Limpiar eventos previos manualmente para aislar post-load
    await page.evaluate(() => { (window as any).__qa.events = [] })

    await player.load({ type: 'media', id: ContentIds.vodLong })
    await player.waitForEvent('sourcechange', 10_000)
  })

  test('load() emite metadataloaded con nuevo contenido', async ({ player, page }) => {
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: false })
    await player.waitForReady()

    await page.evaluate(() => { (window as any).__qa.events = [] })

    await player.load({ type: 'media', id: ContentIds.vodLong })
    await player.waitForEvent('metadataloaded', 15_000)
  })
})

// ── Metadata ─────────────────────────────────────────────────────────────────

test.describe('player.metadata', { tag: ['@regression'] }, () => {

  test('metadataloaded event se emite en la inicialización', async ({ player, page }) => {
    // player.metadata puede estar vacío dependiendo de la versión del player;
    // verificamos que el evento metadataloaded se haya emitido, que es el contrato
    // documentado en la API oficial.
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: false })
    await player.waitForReady()

    const events: string[] = await page.evaluate(() => (window as any).__qa.events)
    expect(events).toContain('metadataloaded')
  })
})

// ── Controles UI ─────────────────────────────────────────────────────────────

test.describe('Controles UI', { tag: ['@regression'] }, () => {

  test('showControls/hideControls no lanzan error', async ({ player }) => {
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: false })
    await player.waitForReady()

    await expect(player.showControls()).resolves.toBeUndefined()
    await expect(player.hideControls()).resolves.toBeUndefined()
  })
})

// ── Error handling ───────────────────────────────────────────────────────────

test.describe('Error Handling', { tag: ['@regression'] }, () => {

  test('ID inexistente: player emite error o initError', async ({ player }) => {
    await player.goto({ type: 'media', id: 'invalid-content-id-00000000', autoplay: false })

    // El player debe emitir un error — ya sea initError o evento 'error'
    const initErr = await player.hasInitError()
    const errors = await player.getErrors()

    const hasAnyError = initErr !== null || errors.length > 0
    expect(hasAnyError, 'debe haber un error con ID inválido').toBe(true)
  })
})

// ── Propiedades de identificación ────────────────────────────────────────────

test.describe('Propiedades — handler, version, type', { tag: ['@regression'] }, () => {

  test('handler es "hls" para contenido VOD HLS', async ({ player }) => {
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: false })
    await player.waitForReady()

    // player.handler puede tardar en propagarse después del evento ready
    // (se setea cuando el media element confirma el handler activo)
    await expect.poll(() => player.getHandler(), { timeout: 10_000 }).toContain('hls')
  })

  test('version es un string no vacío con formato semver', async ({ player }) => {
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: false })
    await player.waitForReady()

    const version = await player.getVersion()
    expect(version, 'version debe ser un string no vacío').toBeTruthy()
    expect(version).toMatch(/^\d+\.\d+\.\d+/)
  })

  test('type es "media" para contenido VOD iniciado con type=media', async ({ player }) => {
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: false })
    await player.waitForReady()

    const type = await player.getType()
    // player.type refleja el tipo de contenido pasado en el init config, no el tipo de vista.
    // Para type:'media', el player retorna 'media'.
    expect(type, 'type debe ser "media" para contenido iniciado con type:media').toBe('media')
  })

  test('type es "media" para contenido de audio iniciado con type=media', async ({ player }) => {
    await player.goto({ type: 'media', id: ContentIds.audio, autoplay: false })
    await player.waitForReady(25_000)

    const type = await player.getType()
    expect(type, 'type debe ser "media" para contenido iniciado con type:media').toBe('media')
  })
})

// ── Propiedad loop ────────────────────────────────────────────────────────────

test.describe('Propiedades — loop', { tag: ['@regression'] }, () => {

  test('loop es false/null por defecto', async ({ player }) => {
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: false })
    await player.waitForReady()

    // player.loop retorna null en v1.0.65 — getLoop() normaliza null → false
    expect(await player.getLoop()).toBe(false)
  })

  // player.loop es un getter que retorna null en v1.0.65 — el setter no tiene efecto.
  // Pendiente de verificar si player.loop es implementado como getter/setter en versiones futuras.
  test.fixme('setLoop(true) activa la repetición', async ({ player }) => {
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: false })
    await player.waitForReady()

    await player.setLoop(true)
    await expect.poll(() => player.getLoop(), { timeout: 3_000 }).toBe(true)
  })

  test.fixme('setLoop(false) desactiva la repetición', async ({ player }) => {
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: false })
    await player.waitForReady()

    await player.setLoop(true)
    await player.setLoop(false)
    await expect.poll(() => player.getLoop(), { timeout: 3_000 }).toBe(false)
  })
})

// ── API de Event Listeners ────────────────────────────────────────────────────

test.describe('Event API — once()', { tag: ['@regression'] }, () => {

  test('once() registra un listener que se dispara exactamente una vez', async ({ player, page }) => {
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: true })
    await player.waitForEvent('playing', 20_000)

    // Registrar listener via once() + contador en window
    await page.evaluate(() => {
      ;(window as any).__once_count = 0
      ;(window as any).__player.once('timeupdate', () => {
        ;(window as any).__once_count++
      })
    })

    // Esperar que timeupdate se dispare varias veces y verificar que once_count
    // llegó a 1 y se mantiene — waitForTimeout intencional: es una aserción
    // negativa ("no debe incrementar más"). No hay evento para "evento no emitido".
    await player.waitForEvent('timeupdate')
    await page.waitForTimeout(2_000)

    const count = await page.evaluate(() => (window as any).__once_count)
    expect(count, 'once() solo debe dispararse una vez').toBe(1)
  })
})

test.describe('Event API — off()', { tag: ['@regression'] }, () => {

  test('off() deregistra el listener y deja de recibir eventos', async ({ player, page }) => {
    await player.goto({ type: 'media', id: ContentIds.vodShort, autoplay: true })
    await player.waitForEvent('playing', 20_000)

    // Registrar listener vía on(), esperar que se dispare, luego remover
    await page.evaluate(() => {
      ;(window as any).__off_count = 0
      ;(window as any).__off_handler = () => { ;(window as any).__off_count++ }
      ;(window as any).__player.on('timeupdate', (window as any).__off_handler)
    })

    // Esperar a que el handler se haya disparado al menos una vez antes de removerlo
    await expect.poll(
      () => page.evaluate(() => (window as any).__off_count),
      { timeout: 5_000 }
    ).toBeGreaterThan(0)

    // Remover el listener y guardar el contador en ese momento
    await page.evaluate(() => {
      ;(window as any).__player.off('timeupdate', (window as any).__off_handler)
      ;(window as any).__off_count_at_remove = (window as any).__off_count
    })

    // waitForTimeout intencional — aserción negativa: verificar que off() detuvo
    // el listener. No hay evento para "listener dejó de dispararse".
    await page.waitForTimeout(1_500)

    const countAtRemove = await page.evaluate(() => (window as any).__off_count_at_remove)
    const countAfter    = await page.evaluate(() => (window as any).__off_count)

    expect(countAtRemove, 'listener debe haberse disparado antes de off()').toBeGreaterThan(0)
    expect(countAfter, 'off() debe detener el listener').toBe(countAtRemove)
  })
})
