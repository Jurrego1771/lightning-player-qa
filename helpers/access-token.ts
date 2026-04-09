/**
 * helpers/access-token.ts — Generación dinámica de Access Tokens
 *
 * Llama al endpoint POST /api/access/issue de la plataforma Mediastream
 * para obtener un token fresco antes de cada test que requiera contenido restringido.
 *
 * Por qué por test y no una vez global:
 *   El token es de "un solo uso" — el servidor lo quema en la primera validación.
 *   Si dos tests paralelos comparten el mismo token, el segundo falla con 403.
 *   Generando un token por fixture-invocation cada test tiene el suyo.
 *
 * Propiedades del token:
 *   - Uso: una sola sesión de reproducción (el servidor lo valida al inicio del stream)
 *   - Ventana de uso: 30 minutos desde la emisión
 *   - Expiración total: 6 horas desde la emisión
 *
 * Variables de entorno requeridas:
 *   PLATFORM_API_TOKEN  — token de API admin (X-API-Token header)
 *   PLATFORM_API_URL    — base URL del API (default: https://dev.platform.mediastre.am/api)
 *
 * Referencia: POST {PLATFORM_API_URL}/access/issue
 * Docs: https://platform.mediastre.am/docs/api/access-token
 */

const DEFAULT_PLATFORM_API_URL = 'https://dev.platform.mediastre.am/api'

interface AccessTokenResponse {
  status:       'OK' | 'ERROR'
  message?:     string
  access_token?: string   // campo real de la API (la doc dice "data" pero la API usa "access_token")
  data?:         string   // campo alternativo documentado
  error?:        string
}

/**
 * Genera un Access Token fresco para un contenido con restricción de acceso.
 *
 * @param id   - ID del Media o Live Stream
 * @param type - 'media' (VOD) o 'live' (Live/DVR)
 * @returns    - El token como string
 * @throws     - Si PLATFORM_API_TOKEN no está configurado o la API falla
 */
export async function generateAccessToken(
  id:   string,
  type: 'media' | 'live',
): Promise<string> {
  const apiToken = process.env.PLATFORM_API_TOKEN
  const baseUrl  = (process.env.PLATFORM_API_URL ?? DEFAULT_PLATFORM_API_URL).replace(/\/$/, '')

  if (!apiToken) {
    throw new Error(
      'PLATFORM_API_TOKEN no configurado en .env\n' +
      '  Necesario para generar access tokens de contenido restringido.\n' +
      '  Ver .env.example para instrucciones.'
    )
  }

  const url = new URL(`${baseUrl}/access/issue`)
  url.searchParams.set('id',   id)
  url.searchParams.set('type', type)

  let response: Response
  try {
    response = await fetch(url.toString(), {
      method:  'POST',
      headers: { 'X-API-Token': apiToken },
      signal:  AbortSignal.timeout(10_000),
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Access token API unreachable (${url.hostname}): ${msg}`)
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(
      `Access token API returned HTTP ${response.status}\n` +
      `  URL: ${url.toString()}\n` +
      `  Body: ${body.slice(0, 200)}`
    )
  }

  let parsed: AccessTokenResponse
  try {
    parsed = await response.json() as AccessTokenResponse
  } catch {
    throw new Error('Access token API: respuesta no es JSON válido')
  }

  // La API devuelve el token en "access_token" (la doc menciona "data" pero el campo real es "access_token")
  const token = parsed.access_token ?? parsed.data

  if (parsed.status !== 'OK' || !token) {
    throw new Error(
      `Access token API: status=${parsed.status}, message=${parsed.message ?? 'none'}\n` +
      `  Verificar que PLATFORM_API_TOKEN tiene permisos de lectura.\n` +
      `  Respuesta: ${JSON.stringify(parsed)}`
    )
  }

  return token
}

/**
 * Verifica si la generación de access tokens está disponible
 * (PLATFORM_API_TOKEN está configurado).
 */
export function isAccessTokenAvailable(): boolean {
  return Boolean(process.env.PLATFORM_API_TOKEN)
}
