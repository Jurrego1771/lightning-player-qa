/**
 * qa-harness.js — QA infrastructure para la app Samsung Tizen TV
 *
 * Expone window.__qa con el mismo contrato que fixtures/player.ts espera,
 * más utilidades específicas para Tizen (key registration, dispatchKey).
 *
 * Este archivo se carga ANTES que el player script.
 */

// ── Keycodes del control remoto Tizen TV ─────────────────────────────────────
// Verificados en Tizen 6.0+ / 8.0 (Samsung 2024)
// Referencia: developer.samsung.com/smarttv/develop/api-references/tizen-web-device-api-references/tvinputdevice-api.html

window.TIZEN_KEYS = {
  // Navegación D-pad
  OK:           13,
  BACK:         10009,
  UP:           38,
  DOWN:         40,
  LEFT:         37,
  RIGHT:        39,
  // Media
  PLAY:         415,
  PAUSE:        19,
  PLAY_PAUSE:   10252,
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
Object.keys(window.TIZEN_KEYS).forEach(function(name) {
  KEY_NAMES[window.TIZEN_KEYS[name]] = name
})

// ── Nombres de teclas para tizen.tvinputdevice.registerKeyBatch() ─────────────
// Estas son las teclas que deben registrarse para que la app las reciba.
// Las teclas de navegación estándar (UP/DOWN/LEFT/RIGHT/ENTER/BACK) se reciben
// sin registro. Las media keys y colores requieren registro explícito.

var TIZEN_REGISTER_KEYS = [
  'MediaPlay',        // PLAY (415)
  'MediaPause',       // PAUSE (19)
  'MediaPlayPause',   // PLAY_PAUSE (10252)
  'MediaStop',        // STOP (413)
  'MediaRewind',      // REWIND (412)
  'MediaFastForward', // FAST_FORWARD (417)
  'ColorF0Red',       // RED (403)
  'ColorF1Green',     // GREEN (404)
  'ColorF2Yellow',    // YELLOW (405)
  'ColorF3Blue',      // BLUE (406)
]

// ── window.__qa — contrato compartido con fixtures/player.ts ─────────────────

window.__qa = {
  ready:       false,
  initialized: false,
  events:      [],
  eventData:   {},
  errors:      [],
  initError:   null,

  keyLog: [],          // [{keyCode, name, timestamp}]

  // Konodrac: igual que webOS harness
  konodracBeacons: [],
}

// ── Registrar teclas del control remoto con la API de Tizen ──────────────────
// Debe llamarse cuando la API tizen.tvinputdevice esté disponible.

function registerTizenKeys() {
  try {
    tizen.tvinputdevice.registerKeyBatch(TIZEN_REGISTER_KEYS, function() {
      // éxito — keys registradas
    }, function(err) {
      console.warn('[harness] registerKeyBatch error:', err)
    })
  } catch (e) {
    // tizen API no disponible (ej: browser desktop en modo desarrollo)
    console.warn('[harness] tizen.tvinputdevice no disponible:', e.message)
  }
}

// Registrar inmediatamente — en Tizen TV la API está disponible al DOMContentLoaded
document.addEventListener('DOMContentLoaded', registerTizenKeys)

// ── Konodrac beacon capture — idéntico al webOS harness ──────────────────────

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

// ── Key logger ────────────────────────────────────────────────────────────────

document.addEventListener('keydown', function(e) {
  var name  = KEY_NAMES[e.keyCode] || ('UNKNOWN_' + e.keyCode)
  var entry = { keyCode: e.keyCode, name: name, timestamp: Date.now() }
  window.__qa.keyLog.push(entry)

  if (window.__debugOverlay) {
    window.__debugOverlay.logKey(name, e.keyCode)
  }
}, true)

// ── dispatchKey — inyecta una tecla sintéticamente (útil para pruebas locales)
//
// Para tests Appium, usar driver.executeScript('tizen: pressKey', [{key:'KEY_PLAYPAUSE'}])
// que envía una tecla real via el protocolo de control remoto.
// dispatchKey() solo despacha un evento keydown sintético dentro del browser.

window.__qa.dispatchKey = function(keyCode, options) {
  var opts  = options || {}
  var event = new KeyboardEvent('keydown', {
    keyCode:    keyCode,
    which:      keyCode,
    bubbles:    opts.bubbles    !== undefined ? opts.bubbles    : true,
    cancelable: opts.cancelable !== undefined ? opts.cancelable : true,
  })

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

// ── __initPlayer — idéntico al harness webOS ──────────────────────────────────

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

      // Backfill — igual que harness desktop y webOS
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
      if (!window.__qa.events.includes('loaded'))         window.__qa.events.push('loaded')
      if (!window.__qa.events.includes('metadataloaded')) window.__qa.events.push('metadataloaded')
      if (player.status === 'error' || window.__qa.errors.length > 0) {
        if (!window.__qa.events.includes('error')) window.__qa.events.push('error')
      }

      window.__qa.ready = true
      if (!window.__qa.events.includes('ready')) window.__qa.events.push('ready')

      // ÚLTIMA línea — las funciones waitFor de los tests esperan este flag
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
