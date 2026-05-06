/**
 * qa-harness.js — QA infrastructure para la app webOS TV
 *
 * Expone window.__qa con el mismo contrato que fixtures/player.ts espera,
 * más utilidades específicas para TV (key mapping, dispatchKey).
 *
 * Este archivo se carga ANTES que el player script.
 */

// ── Keycodes del control remoto webOS 4.x ────────────────────────────────────
// Confirmados en hardware real (webOS 4.54.40)
// Referencia: webostv.developer.lge.com/develop/references/webos-tv-key-codes

window.WEBOS_KEYS = {
  // Navegación D-pad
  OK:           13,
  BACK:         461,
  UP:           38,
  DOWN:         40,
  LEFT:         37,
  RIGHT:        39,
  // Media
  PLAY:         415,
  PAUSE:        19,
  PLAY_PAUSE:   503,
  STOP:         413,
  REWIND:       412,
  FAST_FORWARD: 417,
  // Colores
  RED:          403,
  GREEN:        404,
  YELLOW:       405,
  BLUE:         406,
  // Números (ASCII estándar)
  N0: 48, N1: 49, N2: 50, N3: 51, N4: 52,
  N5: 53, N6: 54, N7: 55, N8: 56, N9: 57,
}

// Mapa inverso para logging legible
var KEY_NAMES = {}
Object.keys(window.WEBOS_KEYS).forEach(function(name) {
  KEY_NAMES[window.WEBOS_KEYS[name]] = name
})

// ── window.__qa — contrato compartido con fixtures/player.ts ─────────────────

window.__qa = {
  ready:       false,
  initialized: false,  // true cuando .then() del loadMSPlayer terminó
  events:      [],     // array de nombres de eventos — igual que harness desktop
  eventData:   {},     // último payload por evento
  errors:      [],
  initError:   null,

  // Extras TV: log de teclas presionadas
  keyLog: [],          // [{keyCode, name, timestamp}]

  // Konodrac: URLs completas de beacons capturadas via Image patch
  // Poblado ANTES de que el request salga a la red — funciona sin network
  konodracBeacons: [], // string[]
}

// ── Konodrac beacon capture — patch HTMLImageElement.prototype.src ────────────
// El tracker usa getImage() que hace new Image(); img.src = url
// Interceptamos el setter a nivel de prototipo para capturar URLs de konograma.com
// ANTES de que el browser haga el request. Funciona sin page.route() y sin red.
;(function() {
  var origDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')
  if (!origDescriptor || !origDescriptor.set) return

  Object.defineProperty(HTMLImageElement.prototype, 'src', {
    get: origDescriptor.get,
    set: function(url) {
      if (url && url.indexOf('konograma.com') !== -1) {
        window.__qa.konodracBeacons.push(url)
        if (window.__debugOverlay && window.__debugOverlay.logKonodrac) {
          try {
            var event = new URL(url).searchParams.get('event') || '?'
            window.__debugOverlay.logKonodrac(event)
          } catch (e) { /* URL parse error — ignorar */ }
        }
      }
      origDescriptor.set.call(this, url)
    },
    configurable: true,
  })
})()

// ── Key logger — registra todas las teclas presionadas ───────────────────────

document.addEventListener('keydown', function(e) {
  var name = KEY_NAMES[e.keyCode] || ('UNKNOWN_' + e.keyCode)
  var entry = { keyCode: e.keyCode, name: name, timestamp: Date.now() }
  window.__qa.keyLog.push(entry)

  if (window.__debugOverlay) {
    window.__debugOverlay.logKey(name, e.keyCode)
  }
}, true)

// ── dispatchKey — permite que Playwright inyecte teclas programáticamente ────
//
// Playwright no puede usar page.keyboard.press() para keyCodes arbitrarios,
// pero sí puede llamar window.__qa.dispatchKey(461) via page.evaluate().

window.__qa.dispatchKey = function(keyCode, options) {
  var opts = options || {}
  var event = new KeyboardEvent('keydown', {
    keyCode:    keyCode,
    which:      keyCode,
    bubbles:    opts.bubbles    !== undefined ? opts.bubbles    : true,
    cancelable: opts.cancelable !== undefined ? opts.cancelable : true,
  })

  // Monkey-patch para detectar si el handler llamó preventDefault()
  var defaultPrevented = false
  var originalPreventDefault = event.preventDefault.bind(event)
  Object.defineProperty(event, 'preventDefault', {
    value: function() {
      defaultPrevented = true
      originalPreventDefault()
    },
    writable: false,
  })

  document.dispatchEvent(event)
  return { defaultPrevented: defaultPrevented }
}

// ── __initPlayer — igual que harness/index.html desktop ─────────────────────

window.__initPlayer = function(config) {
  if (typeof loadMSPlayer === 'undefined') {
    var msg = '[harness] loadMSPlayer no definido. El script del player no cargó.'
    console.error(msg)
    window.__qa.initError = msg
    return Promise.reject(new Error(msg))
  }

  return loadMSPlayer('player-container', config)
    .then(function(player) {
      window.__player = player

      var CUSTOM_EVENTS = [
        'loaded', 'ready', 'sourcechange', 'error', 'buffering',
        'programdatetime', 'adblockerDetected', 'share',
        'levelchange', 'levelchanged',
        'metadataloading', 'metadataloaded', 'metadatachanged',
        'dismissButton',
      ]

      var HTML5_EVENTS = [
        'abort', 'canplay', 'canplaythrough', 'durationchange', 'emptied',
        'ended', 'loadeddata', 'loadedmetadata', 'loadstart',
        'pause', 'play', 'playing', 'progress', 'ratechange',
        'seeked', 'seeking', 'stalled', 'suspend', 'timeupdate',
        'volumechange', 'waiting',
      ]

      var AD_EVENTS = [
        'adsAdBreakReady', 'adsAllAdsCompleted', 'adsClick', 'adsComplete',
        'adsContentPauseRequested', 'adsContentResumeRequested',
        'adsFirstQuartile', 'adsImpression', 'adsLoaded', 'adsMidpoint',
        'adsPaused', 'adsResumed', 'adsSkipped', 'adsStarted',
        'adsThirdQuartile', 'adsError',
      ]

      var TRACK_EVENTS = [
        'texttrackchange', 'texttrackaddtrack', 'texttrackremovetrack',
        'audiotrackchange', 'audiotrackaddtrack', 'audiotrackremovetrack',
      ]

      var ALL_EVENTS = CUSTOM_EVENTS.concat(HTML5_EVENTS, AD_EVENTS, TRACK_EVENTS)

      ALL_EVENTS.forEach(function(eventName) {
        player.on(eventName, function(data) {
          if (eventName === 'timeupdate') {
            if (!window.__qa.events.includes('timeupdate')) {
              window.__qa.events.push('timeupdate')
            }
            return
          }
          window.__qa.events.push(eventName)
          if (data !== undefined) window.__qa.eventData[eventName] = data
          if (eventName === 'ready') window.__qa.ready = true
          if (eventName === 'error') window.__qa.errors.push(data || { message: 'unknown error' })

          if (window.__debugOverlay) window.__debugOverlay.onEvent(eventName, player)
        })
      })

      // Backfill — mismo que harness desktop
      if (player.status === 'playing' || player.status === 'buffering' || !player.paused) {
        if (!window.__qa.events.includes('playing')) window.__qa.events.push('playing')
        if (!window.__qa.events.includes('play'))    window.__qa.events.push('play')
      }
      if (player.readyState >= 3 && !window.__qa.events.includes('canplay')) {
        window.__qa.events.push('canplay')
      }
      if (player.readyState >= 1 && !window.__qa.events.includes('loadedmetadata')) {
        window.__qa.events.push('loadedmetadata')
      }
      if (!window.__qa.events.includes('loaded'))        window.__qa.events.push('loaded')
      if (!window.__qa.events.includes('metadataloaded')) window.__qa.events.push('metadataloaded')
      if (player.status === 'error' || window.__qa.errors.length > 0) {
        if (!window.__qa.events.includes('error')) window.__qa.events.push('error')
      }

      window.__qa.ready = true
      if (!window.__qa.events.includes('ready')) window.__qa.events.push('ready')

      // ÚLTIMA línea — goto() espera este flag
      window.__qa.initialized = true
    })
    .catch(function(err) {
      var msg = '[harness] Error en loadMSPlayer: ' + (err && err.message ? err.message : String(err))
      console.error(msg, err)
      window.__qa.initError = msg
      window.__qa.errors.push({ message: msg })
      if (!window.__qa.events.includes('error')) window.__qa.events.push('error')
    })
}

window.__loadContent = function(options) {
  if (!window.__player) {
    return Promise.reject(new Error('Player not initialized'))
  }
  return window.__player.load(options)
}
