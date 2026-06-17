/**
 * mock-vast/server.ts — Servidor VAST + SGAI HLS de test
 *
 * Sirve respuestas VAST/VMAP y streams HLS con cue markers SGAI.
 * Nunca dispara beacons reales — ideal para CI.
 *
 * Rutas VAST/VMAP:
 *   GET /vast/preroll          → VAST con 1 pre-roll de 15s
 *   GET /vast/preroll-skippable → VAST pre-roll skippable a los 5s
 *   GET /vast/midroll          → VAST con 1 mid-roll
 *   GET /vast/empty            → VAST vacío (no ads)
 *   GET /vast/error-303        → VAST error redirect (code 303)
 *   GET /vast/pod              → VAST con 3 ads en pod
 *   GET /vast/pausead          → VAST NonLinear para pause ad (overlay)
 *   GET /vmap/preroll-midroll  → VMAP con pre-roll + mid-roll a los 30s
 *   GET /vmap/midroll-only     → VMAP con mid-roll único a los 5s (sin pre-roll)
 *   GET /vast/full-metadata    → VAST con AdSystem/AdTitle/MediaFile poblados + skippable
 *   GET /vmap/full-metadata    → VMAP pre+mid(15s)+post apuntando a /vast/full-metadata
 *
 * Rutas SGAI HLS (EXT-X-CUE-OUT):
 *   GET /sgai/live.m3u8?adAt=2&duration=15&segments=16
 *     → HLS level playlist con #EXT-X-CUE-OUT en el segmento `adAt`
 *     → Segmentos: /sgai/segment/:n.ts (redirigen a la fixture VOD en :9001)
 *   GET /sgai/segment/:n.ts
 *     → Redirige a http://localhost:9001/vod/360p/segment00{n%4}.ts
 *
 *   GET /health                → health check
 */
import express from 'express'
import * as fs from 'fs'
import * as path from 'path'
import { PNG } from 'pngjs'

// Imagen del creativo para pause ads (NonLinear). Un PNG sólido 320x180 con tamaño
// no-cero para que el overlay sea visible (toBeVisible). El VAST de pausead apunta a
// /track/pausead-image.jpg como StaticResource.
const TRACK_IMAGE: Buffer = (() => {
  const png = new PNG({ width: 320, height: 180 })
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = 60; png.data[i + 1] = 90; png.data[i + 2] = 140; png.data[i + 3] = 255
  }
  return PNG.sync.write(png)
})()

const app = express()
const PORT = process.env.MOCK_VAST_PORT ? parseInt(process.env.MOCK_VAST_PORT) : 9999
const RESPONSES_DIR = path.join(__dirname, 'responses')

// Default Content-Type for VAST/VMAP routes
app.use((req, res, next) => {
  if (!req.path.startsWith('/sgai') && !req.path.startsWith('/health')) {
    res.setHeader('Content-Type', 'application/xml; charset=utf-8')
  }
  res.setHeader('Access-Control-Allow-Origin', '*')
  console.log(`[mock-vast] ${req.method} ${req.url}`)
  next()
})

const serve = (filename: string) => (_: express.Request, res: express.Response) => {
  const filePath = path.join(RESPONSES_DIR, filename)
  if (!fs.existsSync(filePath)) {
    res.status(404).send(`<error>File not found: ${filename}</error>`)
    return
  }
  res.sendFile(filePath)
}

// ── VAST / VMAP routes ────────────────────────────────────────────────────────

app.get('/vast/preroll', serve('preroll.xml'))
app.get('/vast/preroll-skippable', serve('preroll-skippable.xml'))
app.get('/vast/midroll', serve('midroll.xml'))
app.get('/vast/empty', serve('empty.xml'))
app.get('/vast/error-303', serve('error-303.xml'))
app.get('/vast/pod', serve('pod.xml'))
app.get('/vast/pausead', serve('pausead.xml'))

// ── Tracking / creative assets del pause ad ────────────────────────────────────
// El VAST de pausead referencia /track/pausead-image.jpg (creativo) y beacons
// (/track/pausead-impression, /track/pausead-click). Servimos una imagen real para
// el creativo y 204 para los beacons (fire-and-forget).
app.get('/track/:name', (req: express.Request, res: express.Response) => {
  if (/\.(jpg|jpeg|png|gif|webp)$/i.test(String(req.params.name))) {
    res.type('image/png').send(TRACK_IMAGE)
  } else {
    res.status(204).end() // beacon de tracking
  }
})
app.get('/vmap/preroll-midroll', serve('vmap-preroll-midroll.xml'))
app.get('/vmap/midroll-only', serve('vmap-midroll-only.xml'))
app.get('/vast/full-metadata', serve('vast-full-metadata.xml'))
app.get('/vmap/full-metadata', serve('vmap-full-metadata.xml'))
app.get('/vast/wrapper', serve('wrapper.xml'))

// ── SGAI HLS routes ───────────────────────────────────────────────────────────

/**
 * Genera un HLS level playlist (VOD-like, determinista) con un #EXT-X-CUE-OUT
 * en la posición `adAt` (número de segmento). Los segmentos son servidos por
 * el HLS server en :9001 (fixtures/streams/vod/360p/segment00{n}.ts, en bucle).
 *
 * El ManifestParser del player detecta #EXT-X-CUE-OUT (no EXT-X-DATERANGE) —
 * este es el tag que los encoders AWS Elemental de producción emiten.
 *
 * Query params:
 *   adAt     — índice del segmento donde aparece el CUE-OUT (default: 2)
 *   duration — duración del ad break en segundos (default: 15)
 *   segments — total de segmentos en el playlist (default: 16 → 32s)
 *
 * Ejemplo:
 *   /sgai/live.m3u8?adAt=2&duration=30&segments=20
 */
function generateSGAIManifest(params: {
  segments: number
  adAtSegment: number
  adDuration: number
  baseUrl: string
}): string {
  const { segments, adAtSegment, adDuration, baseUrl } = params
  const lines: string[] = [
    '#EXTM3U',
    '#EXT-X-VERSION:6',
    '#EXT-X-TARGETDURATION:2',
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-INDEPENDENT-SEGMENTS',
  ]

  for (let i = 0; i < segments; i++) {
    if (i === adAtSegment) {
      // EXT-X-CUE-OUT: the tag the player's ManifestParser detects
      lines.push(`#EXT-X-CUE-OUT:Duration=${adDuration}`)
      // Optional: SCTE-35 payload (parser captures it too)
      lines.push('#EXT-OATCLS-SCTE35:/DA0AAAAAAAA///wBQb+AAAAAAA=')
    }
    lines.push(`#EXTINF:2.000000,`)
    // Use a datetime-like segment name so ManifestParser can extract programDateTime
    // Format: media_NNN_20260101T120000_NNNN.ts
    const ts = `2026010${(i % 9) + 1}T12${String(i).padStart(2, '0')}00`
    lines.push(`${baseUrl}/sgai/segment/media_${String(i).padStart(3, '0')}_${ts}_${1000 + i}.ts`)
  }

  lines.push('#EXT-X-ENDLIST')
  return lines.join('\n') + '\n'
}

app.get('/sgai/live.m3u8', (req: express.Request, res: express.Response) => {
  const adAtSegment = parseInt(String(req.query.adAt ?? '2'))
  const adDuration = parseInt(String(req.query.duration ?? '15'))
  const segments = parseInt(String(req.query.segments ?? '16'))
  const baseUrl = `http://localhost:${PORT}`

  res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8')
  res.send(generateSGAIManifest({ segments, adAtSegment, adDuration, baseUrl }))
})

/**
 * Sirve TS segments para el stream SGAI.
 * Redirige al fixture VOD en el HLS server (:9001), usando módulo 4
 * para ciclar entre los 4 segmentos disponibles (segment000..003).
 */
app.get('/sgai/segment/:name.ts', (req: express.Request, res: express.Response) => {
  // Extraer el índice del nombre del segmento (ej: "media_003_..." → 3)
  const match = (req.params.name as string).match(/(\d+)/)
  const n = match ? parseInt(match[1]) % 4 : 0
  const paddedN = String(n).padStart(3, '0')
  const hlsPort = 9001
  res.redirect(`http://localhost:${hlsPort}/vod/360p/segment${paddedN}.ts`)
})

// ── Health ────────────────────────────────────────────────────────────────────

app.get('/health', (_: express.Request, res: express.Response) => {
  res.setHeader('Content-Type', 'application/json')
  res.json({ status: 'ok', port: PORT })
})

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[mock-vast] Server running at http://localhost:${PORT}`)
    console.log(`[mock-vast] SGAI stream: http://localhost:${PORT}/sgai/live.m3u8`)
  })
}

export { app, generateSGAIManifest }
