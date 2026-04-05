/**
 * mock-vast/server.ts — Servidor VAST de test
 *
 * Sirve respuestas VAST/VMAP controladas para tests de ads.
 * Nunca dispara beacons reales — ideal para CI.
 *
 * Rutas disponibles:
 *   GET /vast/preroll          → VAST con 1 pre-roll de 15s
 *   GET /vast/preroll-skippable → VAST pre-roll skippable a los 5s
 *   GET /vast/midroll          → VAST con 1 mid-roll
 *   GET /vast/empty            → VAST vacío (no ads)
 *   GET /vast/error-303        → VAST error redirect (code 303)
 *   GET /vast/pod              → VAST con 3 ads en pod
 *   GET /vmap/preroll-midroll  → VMAP con pre-roll + mid-roll
 *   GET /health                → health check
 */
import express from 'express'
import * as fs from 'fs'
import * as path from 'path'

const app = express()
const PORT = process.env.MOCK_VAST_PORT ? parseInt(process.env.MOCK_VAST_PORT) : 9999
const RESPONSES_DIR = path.join(__dirname, 'responses')

app.use((req, res, next) => {
  res.setHeader('Content-Type', 'application/xml; charset=utf-8')
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

app.get('/vast/preroll', serve('preroll.xml'))
app.get('/vast/preroll-skippable', serve('preroll-skippable.xml'))
app.get('/vast/midroll', serve('midroll.xml'))
app.get('/vast/empty', serve('empty.xml'))
app.get('/vast/error-303', serve('error-303.xml'))
app.get('/vast/pod', serve('pod.xml'))
app.get('/vmap/preroll-midroll', serve('vmap-preroll-midroll.xml'))

app.get('/health', (_, res) => {
  res.setHeader('Content-Type', 'application/json')
  res.json({ status: 'ok', port: PORT })
})

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[mock-vast] Server running at http://localhost:${PORT}`)
  })
}

export { app }
