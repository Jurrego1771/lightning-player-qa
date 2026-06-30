/**
 * helpers/schedule-api.ts — Helper para crear/eliminar schedules en la plataforma Mediastream
 *
 * Usado por tests E2E de blackout (useLiveScheduleCheck) que requieren un schedule
 * de blackout real activo en la plataforma dev para verificar la detección.
 *
 * Auth: X-API-Token (PLATFORM_API_TOKEN en .env) — igual que helpers/access-token.ts
 *
 * Restricción dura: NUNCA borrar el live stream — solo sus schedules.
 * Los schedules de test llevan el prefijo "qa-blackout-" en el nombre para
 * identificarlos y facilitar la limpieza manual si el afterAll falla.
 */

const DEFAULT_PLATFORM_API_URL = 'https://dev.platform.mediastre.am/api'

export interface ScheduleCreateOptions {
  /** ID del live stream (NO el ID del player) */
  liveId: string
  /** Nombre del schedule — default: qa-blackout-{timestamp} */
  name?: string
  /** Si es blackout — default: true */
  isBlackout?: boolean
  /** Fecha inicio 'YYYY-MM-DD' — default: hoy en UTC */
  dateStart?: string
  /** Fecha fin 'YYYY-MM-DD' — default: hoy en UTC */
  dateEnd?: string
  /** Hora de inicio UTC (0-23) — default: hora actual UTC - 1 (ya activo) */
  hourStart?: number
  /** Minuto de inicio (0-59) — default: 0 */
  minuteStart?: number
  /** Hora de fin UTC (0-23) — default: hora actual UTC + 1 */
  hourEnd?: number
  /** Minuto de fin (0-59) — default: 0 */
  minuteEnd?: number
  /** Offset de timezone en horas — default: 0 (UTC) */
  tzOffset?: number
}

export interface ScheduleCreateResult {
  scheduleId: string
  name: string
  liveId: string
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Crea un schedule de blackout en un live stream de la plataforma dev.
 *
 * Por defecto crea el schedule con:
 *   - Inicio: 1 hora antes del momento actual (ya está activo al crearse)
 *   - Fin: 1 hora después del momento actual (activo durante el test)
 *   - Tipo: onetime, is_blackout=true
 *
 * El schedule queda activo hasta la hora de fin o hasta que sea eliminado
 * con deleteScheduleById(). El afterAll de cada test E2E debe llamar a
 * deleteScheduleById() para limpiar.
 *
 * @throws Error si PLATFORM_API_TOKEN no está configurado o la API devuelve error
 */
export async function createBlackoutSchedule(options: ScheduleCreateOptions): Promise<ScheduleCreateResult> {
  const apiToken = process.env.PLATFORM_API_TOKEN
  const baseUrl = (process.env.PLATFORM_API_URL ?? DEFAULT_PLATFORM_API_URL).replace(/\/$/, '')

  if (!apiToken) {
    throw new Error(
      '[schedule-api] PLATFORM_API_TOKEN no configurado — necesario para crear schedules de blackout en tests E2E.\n' +
      '  Agregar a .env: PLATFORM_API_TOKEN=<token-de-api-admin>\n' +
      '  Ver .env.example para instrucciones.'
    )
  }

  const now = new Date()
  const today = todayUTC()

  // Por defecto: inicio 1h antes (ya activo), fin 1h después (activo durante el test)
  const hourStart = options.hourStart ?? ((now.getUTCHours() - 1 + 24) % 24)
  const hourEnd   = options.hourEnd   ?? ((now.getUTCHours() + 1) % 24)

  const {
    liveId,
    name = `qa-blackout-${Date.now()}`,
    isBlackout = true,
    dateStart = today,
    dateEnd = today,
    minuteStart = 0,
    minuteEnd = 0,
    tzOffset = 0, // UTC — no offset
  } = options
  // hourStart / hourEnd ya calculados arriba (con default basado en la hora UTC actual)

  const body = new URLSearchParams({
    name,
    is_blackout: isBlackout ? 'true' : 'false',
    monetizable: 'true',
    type: 'onetime',
    date_start: dateStart,
    date_end: dateEnd,
    date_start_hour: String(hourStart),
    date_start_minute: String(minuteStart),
    date_end_hour: String(hourEnd),
    date_end_minute: String(minuteEnd),
    tz_offset: String(tzOffset),
    // Campos opcionales que el panel envía vacíos/false según capture de red
    code: '',
    description: '',
    for_recording: 'false',
    delayedContent: 'false',
    is_featured: 'false',
    is_auto_publish: 'false',
    not_sellable: 'false',
  })

  let response: Response
  try {
    response = await fetch(`${baseUrl}/live-stream/${liveId}/schedule-job`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-API-Token': apiToken,
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: body.toString(),
    })
  } catch (err: unknown) {
    throw new Error(
      `[schedule-api] createBlackoutSchedule: fallo de red para live ${liveId}\n  ${String(err)}`
    )
  }

  if (!response.ok) {
    let text = ''
    try { text = await response.text() } catch {}
    throw new Error(
      `[schedule-api] createBlackoutSchedule: HTTP ${response.status} para live ${liveId}\n` +
      `  URL: ${baseUrl}/live-stream/${liveId}/schedule-job\n` +
      `  Response: ${text}\n` +
      `  Nota: si es 401/403, verificar que PLATFORM_API_TOKEN tiene permisos de escritura en schedules.`
    )
  }

  let data: { id?: string; _id?: string; name?: string; [k: string]: unknown }
  try {
    data = await response.json() as typeof data
  } catch (err) {
    throw new Error(
      `[schedule-api] createBlackoutSchedule: respuesta no-JSON de la plataforma para live ${liveId}`
    )
  }

  // La plataforma puede devolver el ID bajo distintas keys según versión
  const scheduleId = String(data.id ?? data._id ?? '')

  if (!scheduleId || scheduleId === 'undefined') {
    throw new Error(
      `[schedule-api] createBlackoutSchedule: respuesta sin schedule ID para live ${liveId}\n` +
      `  Body: ${JSON.stringify(data)}`
    )
  }

  return { scheduleId, name, liveId }
}

/**
 * Busca un schedule de blackout ACTUALMENTE ACTIVO (is_current && is_blackout) en el live.
 *
 * Útil para reutilizar un blackout ya existente en lugar de crear uno nuevo (la plataforma
 * rechaza schedules con fechas solapadas: HTTP 500 INVALID_DATE_ERROR_OVERLAPPED_DATES).
 *
 * @returns el schedule activo de blackout, o null si no hay ninguno / falla la consulta.
 */
export async function findActiveBlackoutSchedule(liveId: string): Promise<ScheduleCreateResult | null> {
  const apiToken = process.env.PLATFORM_API_TOKEN
  const baseUrl = (process.env.PLATFORM_API_URL ?? DEFAULT_PLATFORM_API_URL).replace(/\/$/, '')

  if (!apiToken) return null

  let response: Response
  try {
    response = await fetch(`${baseUrl}/live-stream/${liveId}/schedule-job`, {
      method: 'GET',
      headers: {
        'X-API-Token': apiToken,
        'X-Requested-With': 'XMLHttpRequest',
      },
    })
  } catch {
    return null
  }

  if (!response.ok) return null

  let payload: { data?: Array<{ _id?: string; id?: string; name?: string; is_blackout?: boolean; is_current?: boolean }> }
  try {
    payload = await response.json() as typeof payload
  } catch {
    return null
  }

  const active = (payload.data ?? []).find(s => s.is_current === true && s.is_blackout === true)
  if (!active) return null

  return {
    scheduleId: String(active._id ?? active.id ?? ''),
    name: active.name ?? 'blackout',
    liveId,
  }
}

/**
 * Elimina un schedule de un live stream de la plataforma dev.
 *
 * NOTA DE SEGURIDAD: Esta función solo elimina un schedule individual — nunca
 * el live stream. El parámetro liveId solo se usa para construir la URL.
 *
 * Idempotente: no lanza error si el schedule ya fue eliminado (404 = ok).
 * Registra warn en consola si el DELETE falla por cualquier otra causa.
 */
export async function deleteScheduleById(liveId: string, scheduleId: string): Promise<void> {
  const apiToken = process.env.PLATFORM_API_TOKEN
  const baseUrl = (process.env.PLATFORM_API_URL ?? DEFAULT_PLATFORM_API_URL).replace(/\/$/, '')

  if (!apiToken) {
    console.warn('[schedule-api] deleteScheduleById: PLATFORM_API_TOKEN no configurado — cleanup saltado.')
    return
  }

  let response: Response
  try {
    response = await fetch(`${baseUrl}/live-stream/${liveId}/schedule-job/${scheduleId}`, {
      method: 'DELETE',
      headers: {
        'X-API-Token': apiToken,
        'X-Requested-With': 'XMLHttpRequest',
      },
    })
  } catch (err: unknown) {
    console.warn(
      `[schedule-api] deleteScheduleById: fallo de red al borrar schedule ${scheduleId} del live ${liveId}\n  ${String(err)}`
    )
    return
  }

  // 404 = ya eliminado — aceptable (idempotente)
  if (!response.ok && response.status !== 404) {
    console.warn(
      `[schedule-api] deleteScheduleById: HTTP ${response.status} al borrar schedule ${scheduleId} del live ${liveId}\n` +
      `  Limpiar manualmente en https://dev.platform.mediastre.am/live/${liveId}/schedule`
    )
  }
}
