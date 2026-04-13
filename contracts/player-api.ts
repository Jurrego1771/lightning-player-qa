/**
 * contracts/player-api.ts — Contrato formal de la API pública del Lightning Player
 *
 * Este archivo es la fuente de verdad de qué debe exponer el player.
 * Cuando el player team hace un cambio que rompe la API, el test de contrato
 * falla inmediatamente con un mensaje claro — no 30s después con un timeout.
 *
 * Cómo mantener este archivo:
 *   - Al actualizar el player: correr npm run test:contract primero
 *   - Si un ítem fue removido intencionalmente: quitarlo del contrato + actualizar este comentario
 *   - Si un ítem fue agregado: añadirlo aquí para que futuros tests lo usen
 *   - Usar `player_system.md` en .claude/memory/ como referencia autorizada
 *
 * Versión del player validada: 1.0.58
 * Última verificación: 2026-04-08 (desde código fuente del player)
 */

// ── Métodos que deben existir como funciones en la instancia del player ──────

export const REQUIRED_METHODS = [
  'play',
  'pause',
  'destroy',
  'showControls',
  'hideControls',
  'load',
] as const

// ── Propiedades con su tipo esperado ─────────────────────────────────────────
// type: 'number' | 'string' | 'boolean' | 'object' | 'function' | 'any'
// nullable: true → undefined/null es aceptable (prop no inicializada)
// writable: true → se puede hacer setter (player.volume = 0.5)

export interface PropertySpec {
  type:     'number' | 'string' | 'boolean' | 'object' | 'function' | 'any'
  nullable: boolean
  writable: boolean
  description: string
}

export const REQUIRED_PROPERTIES: Record<string, PropertySpec> = {
  // Playback state
  currentTime: { type: 'number',  nullable: false, writable: true,  description: 'Posición de reproducción en segundos' },
  duration:    { type: 'number',  nullable: true,  writable: false, description: 'Duración total (0 o NaN en live)' },
  volume:      { type: 'number',  nullable: false, writable: true,  description: 'Volumen 0–1' },
  paused:      { type: 'boolean', nullable: false, writable: false, description: 'True si está pausado' },
  ended:       { type: 'boolean', nullable: false, writable: false, description: 'True si terminó' },
  muted:       { type: 'boolean', nullable: true,  writable: true,  description: 'True si está muteado (puede ser null antes de que el media esté listo)' },
  playbackRate:{ type: 'number',  nullable: false, writable: true,  description: 'Velocidad de reproducción' },
  loop:        { type: 'boolean', nullable: false, writable: true,  description: 'True si loop está activo' },

  // Player state
  status:  { type: 'string',  nullable: false, writable: false, description: '"playing" | "pause" | "buffering" | "idle"' },
  version: { type: 'string',  nullable: false, writable: false, description: 'Versión del player (ej: "1.0.58")' },
  type:    { type: 'string',  nullable: false, writable: false, description: 'Tipo de contenido (media/live/dvr/...)' },
  handler: { type: 'string',  nullable: true,  writable: false, description: 'Handler activo (hls/native/...)' },

  // Content type flags
  isLive: { type: 'boolean', nullable: false, writable: false, description: 'True si es stream live' },
  isDVR:  { type: 'boolean', nullable: false, writable: false, description: 'True si es DVR' },

  // Ad state (getter — no es función, se accede como player.isPlayingAd sin paréntesis)
  isPlayingAd: { type: 'boolean', nullable: false, writable: false, description: 'True si hay un ad lineal reproduciéndose' },

  // HLS-only (nullable para DASH/MP4)
  level:     { type: 'number', nullable: true, writable: true,  description: 'Nivel HLS activo (-1=auto)' },
  nextLevel: { type: 'number', nullable: true, writable: true,  description: 'Próximo nivel HLS solicitado' },
  levels:    { type: 'object', nullable: true, writable: false, description: 'Array de niveles HLS disponibles' },
  bitrate:   { type: 'number', nullable: true, writable: false, description: 'Bitrate del nivel activo (bps)' },
  bandwidth: { type: 'number', nullable: true, writable: false, description: 'Ancho de banda estimado (bps)' },

  // Tracks
  textTracks:  { type: 'object', nullable: true, writable: false, description: 'TextTrackList (subtítulos)' },
  audioTracks: { type: 'object', nullable: true, writable: false, description: 'AudioTrackList (pistas de audio)' },
}

// ── Eventos que el player debe emitir via window.postMessage ─────────────────
// Divididos por categoría para mejor diagnóstico cuando falla uno.
//
// NOTA: El test de contrato solo verifica que los eventos FUNDAMENTALES
// disparan en el flujo básico (load → ready → play → pause).
// Los eventos de ads, tracks, etc. se verifican en sus specs respectivos.

export const FUNDAMENTAL_EVENTS = [
  'ready',
  'play',
  'playing',
  'pause',
] as const

export const PLAYBACK_EVENTS = [
  'seeking',
  'seeked',
  'ended',
  'buffering',
  'waiting',
  'canplay',
  'loadedmetadata',
] as const

export const AD_EVENTS = [
  'adsStarted',
  'adsComplete',
  'adsAllAdsCompleted',
  'adsError',
  'adsContentPauseRequested',
  'adsContentResumeRequested',
  'adsSkippableStateChanged',
] as const

// ── Eventos de UI ─────────────────────────────────────────────────────────────
// Eventos emitidos por componentes de la UI del player.
// dismissButton: se emite cuando el usuario presiona la flecha de volver en el
// TV skin header. Permite al integrador interceptar la navegación de vuelta.

export const UI_EVENTS = [
  'dismissButton',
] as const

export const CONTENT_EVENTS = [
  'contentFirstPlay',
  'sourcechange',
  'levelchanged',
] as const

// ── Tipo de retorno de isPlayingAd() ─────────────────────────────────────────

export const ISPLAYINGAD_TYPE = 'boolean' as const

// ── Estructura del init result ────────────────────────────────────────────────
// loadMSPlayer() retorna una instancia que debe tener REQUIRED_METHODS como funciones
// y REQUIRED_PROPERTIES accesibles. El test de contrato verifica esto.

export const CONTRACT_VERSION = '1.0.59'
