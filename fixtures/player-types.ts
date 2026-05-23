export type PlayerStatus = 'playing' | 'pause' | 'buffering' | 'idle'
export type ContentType = 'media' | 'live' | 'dvr' | 'episode'
export type PlayerView = 'video' | 'audio' | 'radio' | 'podcast' | 'reels' | 'compact' | 'none'

/**
 * Config de inicialización para loadMSPlayer().
 *
 * Usar `id` (ID de contenido en plataforma Mediastream) como campo principal.
 * `src` es fallback para streams externos en tests específicos — no es el método
 * oficial pero puede funcionar como HTML5 attribute según el tipo de contenido.
 */
export interface InitConfig {
  type: ContentType
  id?: string
  src?: string
  autoplay?: boolean
  volume?: number
  view?: PlayerView
  player?: string
  appName?: string
  dnt?: boolean
  startPos?: number
  adsMap?: string
  accessToken?: string
  customer?: string
  [key: string]: unknown
}

export interface LoadOptions {
  type: ContentType
  id: string
  accessToken?: string
  [key: string]: unknown
}

export interface QoEMetrics {
  currentTime: number
  duration: number
  bufferedAhead: number
  droppedFrames: number
  readyState: number
  isLive: boolean
  isDVR: boolean
  status: PlayerStatus
}

export interface AdInfo {
  clickThroughUrl: string
  contentType: string
  currentTime: number
  duration: number
  podIndex: number
  remainingTime: number
  skippable: boolean
  isLinear: boolean
}
