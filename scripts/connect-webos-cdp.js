/**
 * connect-webos-cdp.js — Helper para que Playwright se conecte al TV via CDP
 *
 * Uso desde playwright.tv.config.ts o directamente en tests:
 *
 *   const { getWebOSCDPTarget } = require('./scripts/connect-webos-cdp')
 *   const wsEndpoint = await getWebOSCDPTarget()
 *
 * Requiere que el tunnel SSH esté activo (deploy-webos.sh ya lo abre).
 * El tunnel mapea: localhost:WEBOS_LOCAL_CDP_PORT → TV:9998
 */

const http = require('http')

const LOCAL_CDP_PORT = parseInt(process.env.WEBOS_LOCAL_CDP_PORT || '9222', 10)

/**
 * Obtiene el WebSocket endpoint de la app Lightning QA en el TV.
 * Consulta http://localhost:CDP_PORT/json y filtra el target correcto.
 *
 * @param {Object} options
 * @param {number} options.timeout   — ms a esperar si el TV aún está cargando (default: 15000)
 * @param {string} options.appId     — ID de la app a buscar (default: com.mediastream.lightningqa)
 * @returns {Promise<string>}        — ws:// endpoint para chromium.connectOverCDP()
 */
async function getWebOSCDPTarget(options = {}) {
  const timeout = options.timeout || 15_000
  const appId = options.appId || process.env.WEBOS_APP_ID || 'com.mediastream.lightningqa'
  const deadline = Date.now() + timeout

  while (Date.now() < deadline) {
    try {
      const targets = await fetchCDPTargets()

      // Buscar el target de nuestra app (por URL o título)
      const target = targets.find((t) =>
        (t.url && t.url.includes(appId)) ||
        (t.url && t.url.includes('index.html')) ||
        (t.title && t.title.includes('Lightning QA'))
      )

      if (target && target.webSocketDebuggerUrl) {
        return target.webSocketDebuggerUrl
      }

      // Si hay targets pero ninguno coincide, loguear para debug
      if (targets.length > 0) {
        console.log('[connect-webos-cdp] Targets disponibles:')
        targets.forEach((t) => console.log(`  - ${t.title} | ${t.url}`))
      }
    } catch (e) {
      // Tunnel no listo aún — reintentar
    }

    await sleep(500)
  }

  throw new Error(
    `[connect-webos-cdp] No se encontró el target CDP de la app '${appId}' en ` +
    `localhost:${LOCAL_CDP_PORT} después de ${timeout}ms.\n` +
    `Verificar:\n` +
    `  1. Tunnel SSH activo: bash scripts/deploy-webos.sh --tunnel-only\n` +
    `  2. App corriendo en el TV: ares-launch --device lg1 ${appId}\n` +
    `  3. TV en Developer Mode con inspectable: true en appinfo.json`
  )
}

/**
 * Devuelve todos los targets CDP disponibles en el puerto local.
 * @returns {Promise<Array>}
 */
function fetchCDPTargets() {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { hostname: 'localhost', port: LOCAL_CDP_PORT, path: '/json', timeout: 3000 },
      (res) => {
        let data = ''
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => {
          try {
            resolve(JSON.parse(data))
          } catch (e) {
            reject(new Error('CDP response parse error: ' + data))
          }
        })
      }
    )
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('CDP request timeout')) })
  })
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

module.exports = { getWebOSCDPTarget, fetchCDPTargets }
