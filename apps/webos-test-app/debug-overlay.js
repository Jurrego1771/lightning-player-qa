/**
 * debug-overlay.js — Overlay visual para debug en el TV
 *
 * Muestra en pantalla: estado del player, último evento, tecla presionada,
 * currentTime. Visible sobre el video para diagnóstico sin necesidad de
 * abrir el Web Inspector.
 */

;(function() {
  var overlay = document.createElement('div')
  overlay.id = 'qa-debug-overlay'
  overlay.style.cssText = [
    'position:fixed',
    'top:20px',
    'right:20px',
    'background:rgba(0,0,0,0.75)',
    'color:#0f0',
    'font-family:monospace',
    'font-size:22px',
    'padding:16px 20px',
    'border-radius:8px',
    'z-index:99999',
    'min-width:320px',
    'line-height:1.6',
    'pointer-events:none',
  ].join(';')

  overlay.innerHTML = [
    '<div>⚡ Lightning QA</div>',
    '<div id="ov-status">status: <span id="ov-status-val">idle</span></div>',
    '<div id="ov-time">time: <span id="ov-time-val">0.0s</span></div>',
    '<div id="ov-event">event: <span id="ov-event-val">—</span></div>',
    '<div id="ov-key">key: <span id="ov-key-val">—</span></div>',
    '<div id="ov-cdp" style="color:#ff0;margin-top:8px">CDP: localhost:9222</div>',
  ].join('')

  document.addEventListener('DOMContentLoaded', function() {
    document.body.appendChild(overlay)
  })

  // Actualizar el tiempo cada segundo
  setInterval(function() {
    if (window.__player) {
      var t = window.__player.currentTime || 0
      var el = document.getElementById('ov-time-val')
      if (el) el.textContent = t.toFixed(1) + 's'

      var s = window.__player.status || 'idle'
      var se = document.getElementById('ov-status-val')
      if (se) {
        se.textContent = s
        se.style.color = s === 'playing' ? '#0f0' : s === 'error' ? '#f00' : '#ff0'
      }
    }
  }, 1000)

  window.__debugOverlay = {
    logKey: function(name, keyCode) {
      var el = document.getElementById('ov-key-val')
      if (el) el.textContent = name + ' (' + keyCode + ')'
    },
    onEvent: function(eventName) {
      var el = document.getElementById('ov-event-val')
      if (el) el.textContent = eventName
    },
  }
})()
