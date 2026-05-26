/**
 * radio-nowplaying-metadata.spec.ts — E2E tests de metadata now-playing en radios de audio
 *
 * Verifica que al hacer POST a la API de nowplaying el player actualiza en tiempo real
 * título, artista e imagen del artista vía Firebase Firestore (onSnapshot).
 *
 * Docs: docs/02-features/nowplaying-metadata.md
 *
 * ⚠️  ESTADO: BLOQUEADOS — ver nota abajo
 *
 * BLOQUEADO: La estación 69724db4002efe954a6c0e00 tiene useID3Sync:true en su
 * configuración de plataforma. Con este flag activo, isPlayingLive() usa matching
 * por ICY artist/title (del stream HLS) en lugar de timestamps. El stream de esta
 * estación emite {type:"ICY"} sin artist ni title, por lo que ningún song de
 * Firestore matchea y player.metadata.title nunca se actualiza desde "Radio QA".
 *
 * Para habilitar estos tests se necesita una estación con useID3Sync:false
 * (o sin el campo en la config de plataforma). Actualizar RADIO_STATION_ID
 * con ese ID y eliminar el test.beforeEach con test.skip() de abajo.
 *
 * Prerrequisitos cuando se desbloquee:
 *   - Conexión a internet (Firebase DEV + nowplaying API + player CDN)
 *   - La estación RADIO_STATION_ID debe estar activa en el ambiente DEV
 *   - view.useID3Sync debe ser false/undefined en la config de plataforma
 *
 * No se usa isolatedPlayer: la feature requiere Firebase real (onSnapshot).
 */
import { test, expect } from '../../fixtures'

// ── Constantes de la estación de test ────────────────────────────────────────

const NOWPLAYING_API    = 'https://dev.nowplaying.mdstrm.com/api/artistsApi/nowplaying'
const NOWPLAYING_APIKEY = '70992a5e909d74be1673ea2267f5e2ab'
const RADIO_STATION_ID  = '69724db4002efe954a6c0e00'  // TODO: reemplazar por estación con useID3Sync:false
const IMAGE_BASE_URL    = 'https://images-meta-platform.cdn.mdstrm.com/'

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Radio Now-Playing Metadata', { tag: ['@radio', '@metadata', '@e2e'] }, () => {

  // BLOQUEADO: estación actual tiene useID3Sync:true — ver cabecera del archivo
  test.beforeEach(() => {
    test.skip(
      true,
      'BLOCKED: Estación 69724db4002efe954a6c0e00 tiene useID3Sync:true. isPlayingLive() usa ICY matching en lugar de timestamps — player.metadata.title nunca actualiza. Necesita estación con useID3Sync:false.'
    )
  })

  test.describe('radio view', () => {

    test('nowplaying: title y subtitle se actualizan tras POST a la API', async ({ player, request }) => {
      await player.goto({
        type: 'live',
        id: RADIO_STATION_ID,
        autoplay: true,
        view: 'radio',
      })
      await player.waitForEvent('playing', 30_000)

      // Usar sufijo único para garantizar updated: true (BR-06)
      const suffix    = Date.now()
      const songTitle = `Creep ${suffix}`
      const artist    = 'Radiohead'

      const response = await request.post(NOWPLAYING_API, {
        params: {
          apikey:     NOWPLAYING_APIKEY,
          stationid:  RADIO_STATION_ID,
          artistname: artist,
          songtitle:  songTitle,
        },
      })

      expect(response.ok()).toBe(true)
      const body = await response.json() as { status: string; updated: boolean }
      expect(body.status).toBe('OK')
      expect(body.updated).toBe(true)

      // Esperar propagación Firebase → player.metadata (BR-04: hasta 45 s por latencia HLS)
      await expect.poll(
        () => player.getMetadata().then((m) => m.title as string | undefined),
        { timeout: 45_000, intervals: [500] }
      ).toBe(songTitle)

      const metadata = await player.getMetadata()
      expect(metadata.subtitle).toBe(artist)
    })

    test('nowplaying: poster es URL válida cuando artista tiene imagen en el catálogo', async ({ player, request }) => {
      await player.goto({
        type: 'live',
        id: RADIO_STATION_ID,
        autoplay: true,
        view: 'radio',
      })
      await player.waitForEvent('playing', 30_000)

      const suffix    = Date.now()
      const songTitle = `Enter Sandman ${suffix}`
      const artist    = 'Metallica'

      const response = await request.post(NOWPLAYING_API, {
        params: {
          apikey:     NOWPLAYING_APIKEY,
          stationid:  RADIO_STATION_ID,
          artistname: artist,
          songtitle:  songTitle,
        },
      })

      const body = await response.json() as { status: string; updated: boolean }
      expect(body.status).toBe('OK')
      expect(body.updated).toBe(true)

      // Esperar a que title refleje la canción nueva
      await expect.poll(
        () => player.getMetadata().then((m) => m.title as string | undefined),
        { timeout: 45_000, intervals: [500] }
      ).toBe(songTitle)

      const metadata = await player.getMetadata()

      // Si el backend tiene imagen para este artista, el poster debe ser una URL válida
      // Si no tiene imagen, poster es null/undefined (BR-03 — fallback en la UI, no error)
      if (metadata.poster) {
        expect(metadata.poster as string).toContain(IMAGE_BASE_URL)
        expect(metadata.poster as string).toMatch(/^https:\/\//)
      }
    })

    test('nowplaying: metadatachanged event se emite cuando la canción cambia', async ({ player, page, request }) => {
      await player.goto({
        type: 'live',
        id: RADIO_STATION_ID,
        autoplay: true,
        view: 'radio',
      })
      await player.waitForEvent('playing', 30_000)

      const suffix    = Date.now()
      const songTitle = `Bohemian Rhapsody ${suffix}`
      const artist    = 'Queen'

      // Capturar el evento metadatachanged antes del POST
      await page.evaluate(() => {
        ;(window as any).__qa_metadatachanged = []
        ;(window as any).__player?.on?.('metadatachanged', (data: unknown) => {
          ;(window as any).__qa_metadatachanged.push(data)
        })
      })

      await request.post(NOWPLAYING_API, {
        params: {
          apikey:     NOWPLAYING_APIKEY,
          stationid:  RADIO_STATION_ID,
          artistname: artist,
          songtitle:  songTitle,
        },
      })

      // Esperar a que player.metadata.title actualice (señal principal)
      await expect.poll(
        () => player.getMetadata().then((m) => m.title as string | undefined),
        { timeout: 45_000, intervals: [500] }
      ).toBe(songTitle)

      // Verificar que el evento fue emitido con los datos correctos
      const events = await page.evaluate(
        () => (window as any).__qa_metadatachanged as Array<Record<string, unknown>>
      )
      const matchingEvent = events.find((e) => e.title === songTitle || e.subtitle === artist)
      expect(matchingEvent).toBeTruthy()
    })

    test('nowplaying: Media Session API refleja la canción actual', async ({ player, page, request }) => {
      // Media Session API puede no estar disponible en todos los entornos headless
      const hasMediaSession = await page.evaluate(() => 'mediaSession' in navigator)
      if (!hasMediaSession) {
        test.skip(true, 'Media Session API no disponible en este navegador/entorno')
        return
      }

      await player.goto({
        type: 'live',
        id: RADIO_STATION_ID,
        autoplay: true,
        view: 'radio',
      })
      await player.waitForEvent('playing', 30_000)

      const suffix    = Date.now()
      const songTitle = `Stairway to Heaven ${suffix}`
      const artist    = 'Led Zeppelin'

      await request.post(NOWPLAYING_API, {
        params: {
          apikey:     NOWPLAYING_APIKEY,
          stationid:  RADIO_STATION_ID,
          artistname: artist,
          songtitle:  songTitle,
        },
      })

      // Esperar a que player.metadata refleje la canción nueva (señal primaria)
      await expect.poll(
        () => player.getMetadata().then((m) => m.title as string | undefined),
        { timeout: 45_000, intervals: [500] }
      ).toBe(songTitle)

      // Luego verificar Media Session (se actualiza ~100ms después de player.metadata)
      await expect.poll(
        () =>
          page.evaluate(() => {
            const ms = navigator.mediaSession?.metadata
            return ms ? { title: ms.title, artist: ms.artist } : null
          }),
        { timeout: 5_000, intervals: [200] }
      ).toMatchObject({ title: songTitle, artist })
    })

  })

  test.describe('compact view', () => {

    test('nowplaying: metadata actualiza en vista compact', async ({ player, request }) => {
      await player.goto({
        type: 'live',
        id: RADIO_STATION_ID,
        autoplay: true,
        view: 'compact',
      })
      await player.waitForEvent('playing', 30_000)

      const suffix    = Date.now()
      const songTitle = `La Venganza de Gaia ${suffix}`
      const artist    = 'Mago de Oz'

      const response = await request.post(NOWPLAYING_API, {
        params: {
          apikey:     NOWPLAYING_APIKEY,
          stationid:  RADIO_STATION_ID,
          artistname: artist,
          songtitle:  songTitle,
        },
      })

      const body = await response.json() as { status: string; updated: boolean }
      expect(body.status).toBe('OK')
      expect(body.updated).toBe(true)

      await expect.poll(
        () => player.getMetadata().then((m) => m.title as string | undefined),
        { timeout: 45_000, intervals: [500] }
      ).toBe(songTitle)

      const metadata = await player.getMetadata()
      expect(metadata.subtitle).toBe(artist)
    })

  })

  test.describe('edge cases', () => {

    test('nowplaying: POST idempotente — mismo título no genera cambio en el player', async ({ player, request }) => {
      await player.goto({
        type: 'live',
        id: RADIO_STATION_ID,
        autoplay: true,
        view: 'radio',
      })
      await player.waitForEvent('playing', 30_000)

      // Primer POST — establece la canción
      const suffix    = Date.now()
      const songTitle = `Test Idempotente ${suffix}`
      const artist    = 'Test Artist'

      const first = await request.post(NOWPLAYING_API, {
        params: {
          apikey:     NOWPLAYING_APIKEY,
          stationid:  RADIO_STATION_ID,
          artistname: artist,
          songtitle:  songTitle,
        },
      })
      const firstBody = await first.json() as { updated: boolean }
      expect(firstBody.updated).toBe(true)

      // Esperar a que el player reciba la primera actualización
      await expect.poll(
        () => player.getMetadata().then((m) => m.title as string | undefined),
        { timeout: 45_000, intervals: [500] }
      ).toBe(songTitle)

      // Segundo POST con mismo título — debe retornar updated: false
      const second = await request.post(NOWPLAYING_API, {
        params: {
          apikey:     NOWPLAYING_APIKEY,
          stationid:  RADIO_STATION_ID,
          artistname: artist,
          songtitle:  songTitle,
        },
      })
      const secondBody = await second.json() as { status: string; updated: boolean }
      expect(secondBody.status).toBe('OK')
      expect(secondBody.updated).toBe(false)

      // Player debe mantener la misma metadata (no hubo cambio)
      const metadata = await player.getMetadata()
      expect(metadata.title).toBe(songTitle)
      expect(metadata.subtitle).toBe(artist)
    })

    test('nowplaying: artista sin imagen — player no falla y poster es null', async ({ player, request }) => {
      await player.goto({
        type: 'live',
        id: RADIO_STATION_ID,
        autoplay: true,
        view: 'radio',
      })
      await player.waitForEvent('playing', 30_000)

      // Usar artista inventado — no tendrá imagen en el catálogo (BR-03)
      const suffix    = Date.now()
      const songTitle = `Cancion Test ${suffix}`
      const artist    = `Artista Inexistente ${suffix}`

      await request.post(NOWPLAYING_API, {
        params: {
          apikey:     NOWPLAYING_APIKEY,
          stationid:  RADIO_STATION_ID,
          artistname: artist,
          songtitle:  songTitle,
        },
      })

      await expect.poll(
        () => player.getMetadata().then((m) => m.title as string | undefined),
        { timeout: 45_000, intervals: [500] }
      ).toBe(songTitle)

      const metadata = await player.getMetadata()
      expect(metadata.subtitle).toBe(artist)

      // poster es null (artista sin imagen) o undefined — el player no debe fallar
      // La UI usa fallback según BR-03: thumbnail → liveimage → DefaultImage
      if (metadata.poster !== null && metadata.poster !== undefined) {
        // Si hay poster, debe ser una URL válida del CDN
        expect(metadata.poster as string).toContain(IMAGE_BASE_URL)
      }

      // Confirmar que el player sigue en estado playing (sin errores)
      await player.assertIsPlaying()
    })

  })

})
