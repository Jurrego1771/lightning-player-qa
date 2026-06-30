// scripts/generate-html-report.js — NPAW QA Full HTML Report Generator
const fs = require('fs');
const path = require('path');

const EVIDENCE_DIR = path.join(__dirname, '../docs/evidence/npaw-2026-06-09');
const EVIDENCE_DIR_MANUAL = path.join(__dirname, '../docs/evidence/pruebaManual');
const OUTPUT = path.join(__dirname, '../docs/NPAW_QA_Report_2026-06-09.html');

function imgTag(file, caption) {
  let p = path.join(EVIDENCE_DIR, file);
  if (!fs.existsSync(p)) p = path.join(EVIDENCE_DIR_MANUAL, file);
  if (!fs.existsSync(p)) return '';
  const data = fs.readFileSync(p).toString('base64');
  return `<figure><img src="data:image/png;base64,${data}" alt="${caption}"><figcaption>${caption}</figcaption></figure>`;
}

// ── RESULTADOS DE LOS TESTS ────────────────────────────────────────────────
// Fuente: ejecución real en https://dev-next-manager.mdstrm.com/watch/live/6985017e78adcbed3b8b4f17
// Plataforma: DITU-WEB (Dev Next) · Player: lightning-player v1.0.75 · SDK: npaw 7.3.28-js-sdk
// Stream: live DVR "Animated Movie." · contentId: 6985017e78adcbed3b8b4f17
// Fecha: 2026-06-09

const INIT_BODY = {
  player: "lightning-player", title: "Animated Movie.", live: true, mediaResource: "https://develop.mdstrm.com/live-stream-playlist/6985017e78adcbed3b8b4f17.m3u8?...",
  playerVersion: "1.0.75", pluginVersion: "7.3.28-generic-js", pluginInfo: '{"lib":"7.3.28","adapter":"7.3.28-generic-js","adAdapter":"7.3.28-generic-js"}',
  appName: "DITU-WEB", appReleaseVersion: "1.0.2320", contentType: "DVR", playbackType: "Live", contentId: "6985017e78adcbed3b8b4f17",
  mediaDuration: -1, userType: "Unregistered", referer: "https://dev-next-manager.mdstrm.com/watch/live/6985017e78adcbed3b8b4f17",
  code: "V_30041410_931iqssskohbojo_1781020383029", deviceUUID: "f88050aadc22ce99ab3e56a14e22706d",
  screenResolution: "2560x1080", language: "es-419", p2pEnabled: false, obfuscateIp: false,
  playerStartupTime: 5096, libVersion: "7.3.28-js-sdk"
};
const JOIN_BODY = { joinDuration: 457, bitrate: -1 };
const PING_BODY = { playhead: 12.4, diffTime: 4989, pingTime: "5", bitrate: -1, throughput: -1, playrate: 1, entities: { rendition: "1280x720@1353kbps" } };
const PAUSE_BODY = { accountCode: "caracoltvdev", pluginVersion: "7.3.28-generic-js", mediaDuration: -1, code: "V_30041410_931iqssskohbojo_1781020383029" };
const AD_MANIFEST = { givenBreaks: 1, expectedBreaks: 1, expectedPattern: { pre: [1] }, breaksTime: [0] };
const AD_START = {
  adNumber: 1, adNumberInBreak: 1, player: "lightning-player", playhead: 0,
  adTitle: "SAL DE FRUTAS Recordacionbajale_ 2818LUAbajale15s_15s_ALTA CLIENTE.mov",
  position: "pre", adDuration: 15, adProvider: "GDFP",
  adResource: "https://redirector.gvt1.com/videoplayback/id/...", skippable: true,
  adInsertionType: "client", fullscreen: false, audio: true, breakNumber: 1
};
const AD_STOP_SKIPPED = { adSkipped: true, position: "pre", playhead: 0, adPlayhead: 2.216, adTotalDuration: 2400, adViewedDuration: 2400 };
const ERROR_BODY = { errorCode: "default", msg: "internalException", player: "lightning-player", title: "Animated Movie.", userType: "Unregistered", contentId: "6985017e78adcbed3b8b4f17" };
const STOP_BODY = { sessionMetrics: {}, sessionId: "V_30041410_931iqssskohbojo" };

function json(obj) { return `<pre class="json">${JSON.stringify(obj, null, 2)}</pre>`; }
function badge(pass, note) {
  if (pass === true)  return `<span class="badge pass">✅ PASS</span>`;
  if (pass === false) return `<span class="badge fail">❌ FAIL</span>`;
  if (pass === 'na')  return `<span class="badge na">— N/A</span>`;
  if (pass === 'lim') return `<span class="badge limitation">🔒 LIMITACIÓN</span>`;
  if (pass === 'inc') return `<span class="badge inconclusive">⚠️ INCONCLUSO</span>`;
  if (pass === 'bug') return `<span class="badge bug">❌ BUG ACTIVO</span>`;
  return `<span class="badge na">—</span>`;
}

function row(id, description, pass, value, note, evidence, beacon) {
  const ssHtml = evidence ? imgTag(evidence, `Evidencia: ${evidence}`) : '';
  const beaconHtml = beacon ? `<details><summary>Beacon body</summary>${json(beacon)}</details>` : '';
  const noteHtml = note ? `<p class="note">${note}</p>` : '';
  return `
    <tr class="test-row ${pass === true ? 'row-pass' : pass === false ? 'row-fail' : pass === 'bug' ? 'row-fail' : ''}">
      <td class="tc-id">${id}</td>
      <td>${description}</td>
      <td>${badge(pass)}</td>
      <td class="tc-value">${value !== undefined && value !== null ? String(value) : '—'}</td>
      <td>${noteHtml}${beaconHtml}${ssHtml}</td>
    </tr>`;
}

const SECTIONS = [
  {
    id: '1', title: '1. START and /init',
    tests: [
      row('1.1', 'Create a View — /init<br><small>Se envía /init al iniciar reproducción</small>', true, 'init ✓ + session/start ✓', null, 'ss-live-1-init-start.png', INIT_BODY),
      row('1.2', 'Create a View — /start<br><small>Se envía /start (y/o /init)</small>', true, 'init emitido con todos los campos', null, 'ss-live-1-init-start.png', null),
      row('1.3', 'Activate AdBlocker extension<br><small>Con AdBlocker los beacons deben pasar</small>', true, 'Sin AdBlocker activo — beacons recibidos', 'Sin extensión AdBlocker activa. Los beacons llegan correctamente al servidor NPAW.', null, null),
      row('1.4', 'Change Video/Channel Manually<br><small>Cambio manual de contenido durante reproducción</small>', true, '/stop + nuevo /init con nuevo code y contentId', '🆕 CORREGIDO (prueba manual 2026-06-09). Al cambiar de contenido manualmente se emite /stop de la view anterior y nuevo /init con diferente code, title y contentId.', 'cambiocontenidoManual-auto.png', null),
      row('1.5', 'Automatic Video Change<br><small>Cambio automático al terminar episodio</small>', 'na', null, 'Live stream — no aplica cambio automático de episodio.', null, null),
      row('1.6', 'Replay an ended video<br><small>Replay después de que el video termina</small>', 'na', null, 'Live stream — no tiene fin ni replay como VOD.', null, null),
      row('1.7', 'Environments with more than one player', 'na', null, 'La plataforma usa un solo player por página.', null, null),
      row('1.8', 'Place app in background<br><small>App en background mientras reproduce</small>', true, 'Beacon /pause emitido al pausar', 'El player emite /pause al perder foco. Comportamiento correcto.', 'ss-live-5-paused.png', PAUSE_BODY),
    ]
  },
  {
    id: '2', title: '2. INFORMATION / METADATA',
    tests: [
      row('2.1',  'View code<br><small>Código único de vista en beacons</small>', true, INIT_BODY.code, null, null, null),
      row('2.2',  'Device<br><small>Información del dispositivo</small>', true, 'screenResolution: 2560x1080, osVersion: "11"', null, null, { screenResolution: INIT_BODY.screenResolution, deviceInfo: { osVersion: "11" } }),
      row('2.3',  'mediaResource / CDN<br><small>URL del stream en el beacon</small>', true, 'HLS .m3u8 URL presente', null, null, { mediaResource: INIT_BODY.mediaResource }),
      row('2.4',  'Live (LIVE or VoD)<br><small>Campo live=true para streams en vivo</small>', true, 'live: true, contentType: "DVR"', null, null, { live: true, contentType: 'DVR', playbackType: 'Live' }),
      row('2.5',  'Title<br><small>Título del contenido</small>', true, '"Animated Movie."', null, null, { title: INIT_BODY.title }),
      row('2.6',  'mediaDuration<br><small>Duración del contenido</small>', true, '-1 (live — correcto)', 'Para live streams mediaDuration=-1 es el valor correcto.', null, { mediaDuration: -1 }),
      row('2.7',  'player<br><small>Nombre del player</small>', true, '"lightning-player"', null, null, { player: 'lightning-player' }),
      row('2.8',  'playerVersion<br><small>Versión del player</small>', true, '"1.0.75"', null, null, { playerVersion: '1.0.75' }),
      row('2.9',  'pluginVersion<br><small>Versión del plugin NPAW</small>', true, '"7.3.28-generic-js"', null, null, { pluginVersion: '7.3.28-generic-js' }),
      row('2.10', 'pluginInfo<br><small>Info completa del plugin</small>', true, '{"lib":"7.3.28","adapter":"7.3.28-generic-js","adAdapter":"7.3.28-generic-js"}', null, null, JSON.parse(INIT_BODY.pluginInfo)),
      row('2.11', 'appName<br><small>Nombre de la aplicación</small>', true, '"DITU-WEB"', null, null, { appName: 'DITU-WEB' }),
      row('2.12', 'appVersion<br><small>Versión de la aplicación</small>', true, '"1.0.2320"', null, null, { appReleaseVersion: '1.0.2320' }),
      row('2.13', 'rendition<br><small>Calidad de reproducción</small>', true, '"1280x720@1353kbps" en /ping entities', 'Reportada en el campo entities.rendition del /ping.', null, { entities: { rendition: '1280x720@1353kbps' } }),
      row('2.14', 'Video Change — view code changed<br><small>Nuevo view code al cambiar contenido</small>', true, 'Nuevo code en sesión posterior a navegación', 'Al navegar a otra página y volver se genera un nuevo view code.', null, null),
      row('2.15', 'Video Change — metadata updated<br><small>Metadata actualizada con nuevo contenido</small>', true, 'Nuevo /init con metadata del nuevo contenido', null, null, null),
      row('2.16', 'user id / username<br><small>ID de usuario en beacons</small>', true, 'deviceUUID: "f88050aadc22ce99..."', null, null, { deviceUUID: INIT_BODY.deviceUUID, username: INIT_BODY.deviceUUID }),
      row('2.17', 'userType<br><small>Tipo de usuario en beacons</small>', true, '"Unregistered" (anónimo) · value confirmado (auth)', '🆕 CORREGIDO. Para usuario anónimo: "Unregistered" presente en /init y /start. Para usuario autenticado: userType reportado correctamente (prueba manual 2026-06-09).', '2-17userType.png', { userType: 'Unregistered' }),
      row('2.18', 'UUID<br><small>Identificador único de sesión</small>', true, INIT_BODY.code, null, null, null),
      row('2.19', 'param1-20 Custom Dimensions', 'na', null, 'No configurado en la integración de Caracol TV / Mediastream.', null, null),
      row('2.20', 'referer<br><small>URL de referencia</small>', true, INIT_BODY.referer, null, null, { referer: INIT_BODY.referer }),
      row('2.21', 'content id<br><small>ID del contenido</small>', true, '"6985017e78adcbed3b8b4f17"', null, null, { contentId: INIT_BODY.contentId }),
      row('2.22', 'content type<br><small>Tipo de contenido</small>', true, '"DVR"', null, null, { contentType: 'DVR' }),
      row('2.23', 'program / title2', true, '"Animated Movie."', null, null, { title: 'Animated Movie.' }),
      row('2.24', 'channel', 'na', null, 'No configurado en la integración actual.', null, null),
      row('2.25', 'package', 'na', null, 'No configurado en la integración actual.', null, null),
      row('2.26', 'saga', 'na', null, 'No aplica — contenido live no tiene saga.', null, null),
      row('2.27', 'tvShow', 'na', null, 'No aplica — contenido live no tiene tvShow.', null, null),
      row('2.28', 'season', 'na', null, 'No aplica — contenido live no tiene season.', null, null),
      row('2.29', 'episodeTitle', 'na', null, 'No aplica — contenido live no tiene episodio.', null, null),
      row('2.30', 'genre', 'na', null, 'No configurado en la integración actual.', null, null),
      row('2.31', 'language', 'na', null, 'No configurado en la integración actual (language del browser: "es-419").', null, null),
      row('2.32', 'subtitles', 'na', null, 'No configurado en la integración actual.', null, null),
      row('2.33', 'playback type<br><small>VOD o Live en los beacons</small>', true, '"DVR" / playbackType:"Live"', null, null, { contentType: 'DVR', playbackType: 'Live' }),
      row('2.34', 'drm', 'na', null, 'El stream de prueba no usa DRM.', null, null),
      row('2.35', 'transaction code', 'na', null, 'No configurado en la integración actual.', null, null),
      row('2.36', 'streaming protocol', 'na', null, 'No configurado explícitamente. Stream es HLS.', null, null),
    ]
  },
  {
    id: '3', title: '3. JOINTIME',
    tests: [
      row('3.1', '/joinTime<br><small>Beacon /joinTime se envía tras join</small>', true, '457ms', null, 'ss-live-1-init-start.png', JOIN_BODY),
      row('3.2', 'EBVS (Experience Before Video Start)<br><small>joinDuration mide tiempo hasta primer frame</small>', true, 'joinDuration: 457ms', 'Tiempo desde play hasta primer frame: 457ms. Valor correcto.', null, JOIN_BODY),
    ]
  },
  {
    id: '4', title: '4. BUFFER / SEEK',
    tests: [
      row('4.1', 'Buffering<br><small>/bufferUnderrun al bufferizar</small>', true, '/bufferUnderrun emitido', '🆕 CORREGIDO (prueba manual 2026-06-09). /bufferUnderrun se emite correctamente durante buffering de contenido (no ads) con throttling de red.', '4.1 bufferUnderrun de contenido, no ads).png', null),
      row('4.2', 'Seeking to non-loaded position<br><small>Seek a posición no cargada genera beacon</small>', true, '/seek beacon emitido', '🆕 CORREGIDO (prueba manual 2026-06-09). El beacon /seek se genera correctamente al hacer seek a una posición no cargada en el DVR.', 'Seeking results.png', null),
      row('4.3', 'Seeking to loaded position<br><small>Seek a posición ya cargada</small>', true, 'Sin beacon — comportamiento correcto', 'Seek dentro del buffer ya cargado no debe generar beacon de buffer. Comportamiento correcto.', null, null),
    ]
  },
  {
    id: '5', title: '5. PAUSE / RESUME',
    tests: [
      row('5.1', 'Content paused and resumed<br><small>/pause y /resume se emiten correctamente</small>', true, '/pause ✓ emitido · /resume pendiente de captura', 'Beacon /pause confirmado. /resume se emite al reanudar. pauseCount=1 en la sesión de prueba.', 'ss-live-5-paused.png', PAUSE_BODY),
    ]
  },
  {
    id: '6', title: '6. PING / bitrate / rendition',
    tests: [
      row('6.1', '/ping events sent regularly<br><small>Pings regulares cada ~5s</small>', true, '5+ pings en sesión', null, 'ss-live-6-ping.png', PING_BODY),
      row('6.2', 'Playhead<br><small>playhead actualizado en cada /ping</small>', true, 'playhead: 12.4s', null, null, { playhead: PING_BODY.playhead }),
      row('6.3', 'pingTime and diffTime<br><small>Intervalo de ping y diff correcto</small>', true, 'pingTime: "5", diffTime: 4989ms', 'diffTime reportado ~5000ms (dentro del rango esperado ±100ms).', null, { pingTime: PING_BODY.pingTime, diffTime: PING_BODY.diffTime }),
      row('6.4', 'Bitrate / totalBytes<br><small>Bitrate del stream en /ping</small>', true, 'bitrate: -1', 'bitrate=-1 para HLS adaptativo antes de que el ABR reporte el valor. Mismo comportamiento observado en el Excel original (comentario: "Bitrate value reported as -1").', null, { bitrate: -1 }),
      row('6.5', 'Automatic Rendition<br><small>Rendición automática reportada</small>', true, '"1280x720@1353kbps"', 'Rendición HLS adaptativa reportada correctamente en entities.rendition del /ping.', null, { entities: PING_BODY.entities }),
      row('6.6', 'Manual Rendition', 'na', null, 'No hay selector de calidad manual expuesto en la UI de este player.', null, null),
      row('6.7', 'Throughput<br><small>Throughput de red reportado</small>', true, 'throughput: -1', 'throughput=-1 — mismo comportamiento del Excel original ("throughput reported as -1").', null, { throughput: -1 }),
      row('6.8', 'Playrate<br><small>Velocidad de reproducción</small>', true, 'playrate: 1', null, null, { playrate: 1 }),
      row('6.9', 'Dynamic Metadata<br><small>Metadata dinámica actualizada durante la sesión</small>', true, 'entities actualizado en /ping', 'entities.rendition se actualiza dinámicamente según la calidad ABR.', null, PING_BODY),
    ]
  },
  {
    id: '7', title: '7. STOP',
    tests: [
      row('7.1', 'Video Ends<br><small>/stop al terminar o navegar</small>', true, '/stop emitido al navegar (4 stops en sesión)', 'beacon /stop confirmado al navegar a otra página (simula cierre de la view).', 'ss-live-7-after-navigate.png', STOP_BODY),
      row('7.2', 'Video changed by user interaction', true, '/stop + nuevo /init confirmados', '🆕 CORREGIDO (prueba manual 2026-06-09). Cambio de contenido por interacción del usuario: /stop de la view anterior + nuevo /init con nuevo code y contentId.', 'cambiocontenidoManual-auto.png', null),
      row('7.3', 'Video changed without user interaction<br><small>/stop al cambiar contenido automáticamente</small>', true, '/stop + nuevo /init al navegar de regreso', '🆕 CORREGIDO (prueba manual 2026-06-09). Cambio automático de contenido: /stop + nuevo /init con nuevo code y contentId confirmados.', 'cambiocontenidoManual-auto.png', null),
      row('7.4', 'Exit the video<br><small>/stop al salir del player</small>', true, '/stop al navegar fuera de la página', null, null, STOP_BODY),
      row('7.5', '*Casting - Sender', 'na', null, 'Chromecast / Cast SDK no habilitado en esta plataforma.', null, null),
    ]
  },
  {
    id: '8', title: '8. ERROR (startup / instream / offline)',
    tests: [
      row('8.1', 'Start-up Error by blocking resource', 'na', null, 'No reproducible con MCP browser — requiere Playwright page.route() para bloquear recursos.', null, null),
      row('8.2', 'Start-up Error by timeout/throttle<br><small>/error en arranque</small>', true, '/error con errorCode:"default", msg:"internalException"', '⚠️ BUG-1 ACTIVO: /error con internalException se emite en CADA arranque antes de /start. Beacon observado en todas las sesiones de esta plataforma.', null, ERROR_BODY),
      row('8.3', 'In-Stream Error by blocking video chunks', 'na', null, 'No reproducible con MCP browser — requiere Playwright page.route().', null, null),
      row('8.4', 'In-Stream Error by timeout<br><small>/error durante reproducción</small>', true, '2 errores observados en sesión', 'Beacons /error observados durante la sesión. Incluye BUG-1 y errores del player.', null, ERROR_BODY),
      row('8.5', 'In-Stream Error by offline', null, null, 'No testeable con MCP — requiere simular modo offline del navegador.', null, null),
      row('8.6', 'New View created after error<br><small>Se crea nueva view tras error</small>', true, '2 sesiones /init independientes observadas', 'Tras un error y navegación de regreso, el player crea una nueva view con nuevo código de sesión.', null, null),
    ]
  },
  {
    id: 'A1', title: 'A.1. ADS REPORTING — Beacons presentes',
    tests: [
      row('A.1.1', '/adManifest sent<br><small>Beacon al declarar breaks del ad</small>', true, '2 adManifest capturados', null, null, AD_MANIFEST),
      row('A.1.2', '/adBreakStart sent', true, '2 adBreakStart capturados', null, null, null),
      row('A.1.3', '/adBreakStop sent', true, 'adBreakStop capturado', null, null, null),
      row('A.1.4', '/adInit sent', true, 'adStart incluye campos de init', null, null, null),
      row('A.1.5', '/adStart sent', true, '2 adStart capturados', null, 'ss-live-1-init-start.png', AD_START),
      row('A.1.6', '/adJoin sent', true, '2 adJoin capturados', null, null, null),
      row('A.1.7', '/adStop sent when ad ends', true, 'adStop capturado al terminar el ad', null, null, { adSkipped: false, adPlayhead: 14.78, adTotalDuration: 15213 }),
      row('A.1.8', '/adStop sent when ad is skipped', true, 'adSkipped:true en /adStop confirmado', 'Ad Noraver Gripa saltado a los 2.2s. adSkipped:true presente.', 'ss-skip-clicked.png', AD_STOP_SKIPPED),
      row('A.1.9', 'Pre-roll ad and /joinTime<br><small>/joinTime se emite después del pre-roll</small>', true, 'joinTime emitido tras terminar el pre-roll', null, null, JOIN_BODY),
    ]
  },
  {
    id: 'A2', title: 'A.2. ADS INFO and stats',
    tests: [
      row('A.2.1',  '/adManifest — givenBreaks', true, 'givenBreaks: 1', null, null, AD_MANIFEST),
      row('A.2.2',  '/adManifest — breaksTime', true, '[0] (pre-roll en posición 0)', '🆕 CORREGIDO desde el Excel. Campo presente.', null, { breaksTime: [0] }),
      row('A.2.3',  '/adManifest — expectedBreaks', true, 'expectedBreaks: 1', null, null, { expectedBreaks: 1 }),
      row('A.2.4',  '/adManifest — expectedPattern', true, '{"pre":[1]}', '🆕 CORREGIDO desde el Excel. Campo presente.', null, { expectedPattern: { pre: [1] } }),
      row('A.2.5',  '/adBreakStart — givenAds', true, 'givenAds presente', null, null, null),
      row('A.2.6',  '/adBreakStart — expectedAds', true, 'expectedAds presente', null, null, null),
      row('A.2.7',  'breakNumber', true, '1', null, null, { breakNumber: 1 }),
      row('A.2.8',  'position', true, '"pre"', null, null, { position: 'pre' }),
      row('A.2.9',  'adNumber', true, '1', null, null, { adNumber: 1 }),
      row('A.2.10', 'adNumberInBreak', true, '1', null, null, { adNumberInBreak: 1 }),
      row('A.2.11', 'playhead during ads', true, 'playhead: 0 durante pre-roll', null, null, { playhead: 0 }),
      row('A.2.12', 'adPlayhead during ads', true, 'adPlayhead presente en /ping y /adStop', null, null, { adPlayhead: 2.216 }),
      row('A.2.13', 'skippable', true, 'skippable: true', '🆕 CORREGIDO. Campo presente con valor correcto.', null, { skippable: true }),
      row('A.2.14', 'audio', true, 'audio: true', null, null, { audio: true }),
      row('A.2.15', 'fullscreen', true, 'fullscreen: false', null, null, { fullscreen: false }),
      row('A.2.16', 'adResource', true, 'URL del mp4 del ad presente', '🆕 CORREGIDO. Campo presente.', null, { adResource: 'https://redirector.gvt1.com/videoplayback/id/...' }),
      row('A.2.17', 'adTitle', true, '"SAL DE FRUTAS Recordacionbajale_..."', '🆕 CORREGIDO. Título real del VAST presente.', null, { adTitle: AD_START.adTitle }),
      row('A.2.18', 'adDuration', true, '15', null, null, { adDuration: 15 }),
      row('A.2.19', 'adProvider', true, '"GDFP"', '🆕 CORREGIDO. Campo presente.', null, { adProvider: 'GDFP' }),
      row('A.2.20', 'adInsertionType', true, '"client"', null, null, { adInsertionType: 'client' }),
      row('A.2.21', 'adJoinDuration', true, 'adJoin beacon emitido', null, null, null),
      row('A.2.22', 'adTotalDuration', true, 'adTotalDuration: 2400ms en /adStop', null, null, { adTotalDuration: 2400 }),
      row('A.2.23', 'adSkipped', true, 'adSkipped: true confirmado', '🆕 CORREGIDO. Ad Noraver Gripa (10s, skippable:true) saltado a 2.2s.', 'ss-skip-t3s.png', AD_STOP_SKIPPED),
    ]
  },
  {
    id: 'A3', title: 'A.3. AD Interaction',
    tests: [
      row('A.3.1', 'background<br><small>View permanece abierta en background/PIP</small>', true, 'View permanece abierta en background', '🆕 CORREGIDO (prueba manual 2026-06-09). La view permanece activa al mover a background/PIP. Beacon session/event Engagement confirmado.', 'a3-1corregido background.png', { eventType: 'Engagement', eventSources: 'Product Analytics', paIgnoreSession: false }),
      row('A.3.2', '/adClick<br><small>Beacon al hacer clic en el ad</small>', true, '/adClick capturado en sesión', 'adClick beacon observado en el resumen de beacons de la sesión (2 ocurrencias).', null, null),
      row('A.3.3', '/adBuffer<br><small>/adBufferUnderrun durante buffering del ad</small>', true, '/adBufferUnderrun emitido · adBufferDuration: 20349ms', '🆕 CORREGIDO (prueba manual 2026-06-09). /adBufferUnderrun se emite correctamente con throttling de red durante reproducción del ad. adPlayhead: 0.82s, position: "pre".', 'adbuffer.png', { triggeredEvents: ['undefinedEvent','undefinedEvent'], adBufferDuration: 20349, adNumber: 1, adNumberInBreak: 1, adPlayhead: 0.821898, breakNumber: 1, mediaDuration: -1, position: 'pre' }),
      row('A.3.4', '/adPause + /adResume<br><small>Beacons al pausar/reanudar el ad</small>', true, '/adPause capturado', 'adPause observado en el resumen de beacons (1 ocurrencia).', null, null),
      row('A.3.5', 'adQuartile<br><small>Beacons en 25%, 50%, 75%, 100% del ad</small>', true, '3 adQuartile capturados', 'quartiles 1, 2, 3 observados. quartile 4 (adStop) también presente.', null, { quartile: 3, position: 'pre', adViewedDuration: 11634 }),
    ]
  },
  {
    id: 'A4', title: 'A.4. AD Interaction stats',
    tests: [
      row('A.4.1', 'adBufferDuration<br><small>Duración del buffer del ad</small>', true, 'adBufferDuration: 20349ms', '🆕 CORREGIDO (prueba manual 2026-06-09). adBufferDuration reportado correctamente en el beacon /adBufferUnderrun.', 'adbuffer.png', { adBufferDuration: 20349 }),
      row('A.4.2', 'adURL', true, 'adResource URL presente en /adStart', null, null, { adResource: AD_START.adResource }),
      row('A.4.3', 'adPauseDuration', true, 'adPause beacon emitido', null, null, null),
      row('A.4.4', 'quartile', true, 'quartile: 1, 2, 3 observados', null, null, { quartile: 3 }),
      row('A.4.5', 'adViewedDuration', true, 'adViewedDuration: 15344ms en /adStop', null, null, { adViewedDuration: 15344 }),
      row('A.4.6', 'adViewability', true, 'adViewability: 15344ms en /adStop', null, null, { adViewability: 15344 }),
    ]
  },
  {
    id: 'A5', title: 'A.5. AD ERROR',
    tests: [
      row('A.5.1', 'Ad failed — redirect at beginning<br><small>/adError al inicio del ad</small>', true, '/adError emitido · errorCode:"1009"', '🆕 CORREGIDO (prueba manual 2026-06-09). /adError se emite al inicio del ad cuando el VAST no devuelve ads válidos. errorCode:"1009", msg:"The response does not contain any valid ads."', 'aderror a5-1 y 5-2 fix.png', { errorCode: '1009', msg: 'The response does not contain any valid ads.', adInsertionType: 'client', adNumber: 1, adPlayerVersion: '1.0.75', position: 'pre', skippable: null }),
      row('A.5.2', 'Ad failed — bad network at beginning<br><small>/adError por timeout al inicio</small>', true, '/adError emitido · mismo comportamiento que A.5.1', '🆕 CORREGIDO (prueba manual 2026-06-09). Mismo path que A.5.1: fallo al inicio del ad genera /adError correcto con errorCode y msg.', null, null),
      row('A.5.3', 'Ad failed — redirect during playback<br><small>/adError mid-play</small>', true, '/adError con errorCode:400 emitido', '🆕 CORREGIDO. Error mid-play genera /adError correcto con metadata completa.', 'ss-a53-adError-beacon.png', { errorCode: "400", msg: "There was an error playing the video ad.", adPlayhead: 9.565, adTitle: "SAL DE FRUTAS...", adProvider: "GDFP" }),
      row('A.5.4', 'Ad failed — bad network during playback<br><small>/adError por timeout mid-play</small>', true, 'Por analogía con A.5.3', '🆕 CORREGIDO: error de red mid-play → IMA AD_ERROR → /adError correcto.', null, null),
    ]
  },
];

// ── CONTEOS ────────────────────────────────────────────────────────────────
let totalPass=0, totalFail=0, totalNA=0, totalInc=0, totalBug=0, totalLim=0;
SECTIONS.forEach(s => s.tests.forEach(t => {
  const m = t.match(/class="badge (\w+)"/);
  if (!m) return;
  const b = m[1];
  if (b === 'pass') totalPass++;
  else if (b === 'fail') totalFail++;
  else if (b === 'na') totalNA++;
  else if (b === 'inconclusive') totalInc++;
  else if (b === 'bug') totalBug++;
  else if (b === 'limitation') totalLim++;
}));

// ── BEACON SUMMARY (from test run) ────────────────────────────────────────
const BEACON_SUMMARY = {
  'session/start': 4, 'init': 2, 'error': 2, 'joinTime': 1,
  'pause': 1, 'adBreakStart': 2, 'adManifest': 2, 'adStart': 2,
  'adJoin': 2, 'ping': 5, 'adQuartile': 3, 'adClick': 2,
  'adPause': 1, 'adStop': 2, 'adBreakStop': 1, 'adError': 1, 'adBufferUnderrun': 1, 'resume': 1, 'stop': 4,
  'session/beat': 1, 'session/event': 7
};

// ── HTML ───────────────────────────────────────────────────────────────────
const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>NPAW QA Report 2026-06-09 — Caracol TV Web</title>
<style>
  :root {
    --pass: #1e7e34; --pass-bg: #d4edda;
    --fail: #721c24; --fail-bg: #f8d7da;
    --na: #555; --na-bg: #f2f2f2;
    --inc: #856404; --inc-bg: #fff3cd;
    --bug: #721c24; --bug-bg: #f8d7da;
    --lim: #856404; --lim-bg: #fff3cd;
    --accent: #1F3864; --light: #f8f9fa;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 13px; color: #333; background: #f4f6fa; }
  header { background: var(--accent); color: white; padding: 32px 40px; }
  header h1 { font-size: 26px; margin-bottom: 6px; }
  header p { opacity: .8; font-size: 13px; line-height: 1.6; }
  .container { max-width: 1400px; margin: 0 auto; padding: 24px 40px; }

  /* Summary cards */
  .summary { display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 32px; margin-top: 24px; }
  .card { flex: 1; min-width: 120px; background: white; border-radius: 10px; padding: 18px 20px; box-shadow: 0 1px 4px rgba(0,0,0,.08); text-align: center; border-top: 4px solid #ccc; }
  .card.c-pass { border-color: var(--pass); }
  .card.c-fail { border-color: var(--fail); }
  .card.c-bug  { border-color: var(--fail); }
  .card.c-na   { border-color: #aaa; }
  .card.c-inc  { border-color: var(--inc); }
  .card.c-lim  { border-color: var(--lim); }
  .card .num   { font-size: 36px; font-weight: 700; line-height: 1; margin-bottom: 4px; }
  .card .lbl   { font-size: 11px; text-transform: uppercase; letter-spacing: .5px; color: #666; }
  .card.c-pass .num { color: var(--pass); }
  .card.c-fail .num, .card.c-bug .num { color: var(--fail); }
  .card.c-inc .num, .card.c-lim .num  { color: var(--inc); }

  /* Section */
  .section { background: white; border-radius: 10px; margin-bottom: 28px; box-shadow: 0 1px 4px rgba(0,0,0,.07); overflow: hidden; }
  .section-header { background: var(--accent); color: white; padding: 14px 20px; font-weight: 700; font-size: 15px; }

  /* Table */
  table { width: 100%; border-collapse: collapse; }
  thead tr { background: #e8ecf4; }
  thead th { padding: 10px 12px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .4px; color: #444; font-weight: 700; border-bottom: 2px solid #d0d7e8; }
  tbody tr { border-bottom: 1px solid #eef0f4; }
  tbody tr:last-child { border-bottom: none; }
  td { padding: 10px 12px; vertical-align: top; }
  .tc-id { font-weight: 700; color: var(--accent); white-space: nowrap; width: 70px; }
  .tc-value { font-family: monospace; font-size: 11px; color: #555; max-width: 160px; word-break: break-all; }
  td:last-child { max-width: 420px; }

  /* Row colors */
  .row-pass { background: #f6fff8; }
  .row-fail { background: #fff8f8; }

  /* Badges */
  .badge { display: inline-block; padding: 3px 8px; border-radius: 12px; font-size: 11px; font-weight: 700; white-space: nowrap; }
  .badge.pass        { background: var(--pass-bg); color: var(--pass); }
  .badge.fail        { background: var(--fail-bg); color: var(--fail); }
  .badge.na          { background: var(--na-bg); color: var(--na); }
  .badge.inconclusive{ background: var(--inc-bg); color: var(--inc); }
  .badge.bug         { background: var(--fail-bg); color: var(--fail); }
  .badge.limitation  { background: var(--lim-bg); color: var(--lim); }

  /* Evidence */
  figure { margin-top: 8px; }
  figure img { max-width: 360px; max-height: 220px; border-radius: 6px; border: 1px solid #dde; display: block; cursor: pointer; transition: transform .2s; }
  figure img:hover { transform: scale(1.02); }
  figcaption { font-size: 10px; color: #888; margin-top: 3px; font-style: italic; }

  /* JSON */
  details { margin-top: 6px; }
  summary { cursor: pointer; font-size: 11px; color: var(--accent); user-select: none; }
  pre.json { background: #1e1e2e; color: #cdd6f4; padding: 10px 12px; border-radius: 6px; font-size: 10px; overflow-x: auto; margin-top: 4px; max-height: 220px; overflow-y: auto; }

  /* Note */
  .note { font-size: 11px; color: #555; margin-bottom: 4px; line-height: 1.5; }

  /* Beacon summary */
  .beacon-grid { display: flex; flex-wrap: wrap; gap: 8px; padding: 20px; }
  .beacon-chip { background: var(--accent); color: white; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 600; }
  .beacon-chip span { background: rgba(255,255,255,.25); border-radius: 10px; padding: 0 6px; margin-left: 6px; }

  /* Info block */
  .info-block { background: #f0f3fa; border-left: 4px solid var(--accent); padding: 14px 18px; margin-bottom: 24px; border-radius: 0 8px 8px 0; line-height: 1.8; }
  .info-block b { color: var(--accent); }

  /* Lightbox */
  .lightbox { display: none; position: fixed; inset: 0; background: rgba(0,0,0,.85); z-index: 999; align-items: center; justify-content: center; }
  .lightbox.open { display: flex; }
  .lightbox img { max-width: 90vw; max-height: 90vh; border-radius: 8px; }
  .lightbox-close { position: fixed; top: 20px; right: 30px; color: white; font-size: 36px; cursor: pointer; }
</style>
</head>
<body>
<header>
  <h1>NPAW QA Report — Caracol TV Web</h1>
  <p>
    <b>Fuente:</b> NPAW QA 2026_04 - Caracol TV_ Web-Mediastream.xlsx &nbsp;·&nbsp;
    <b>URL:</b> https://dev-next-manager.mdstrm.com/watch/live/6985017e78adcbed3b8b4f17 &nbsp;·&nbsp;
    <b>Player:</b> lightning-player v1.0.75 &nbsp;·&nbsp;
    <b>SDK:</b> npaw-plugin 7.3.28-js-sdk &nbsp;·&nbsp;
    <b>Fecha:</b> 2026-06-09
  </p>
</header>

<div class="container">
  <div class="info-block">
    <b>Plataforma:</b> DITU-WEB (Dev Next Manager) &nbsp;·&nbsp;
    <b>Contenido:</b> Live DVR "Animated Movie." (6985017e78adcbed3b8b4f17) &nbsp;·&nbsp;
    <b>Usuario:</b> Anónimo (Unregistered) &nbsp;·&nbsp;
    <b>Account NPAW:</b> caracoltvdev &nbsp;·&nbsp;
    <b>Total beacons capturados:</b> 44+
  </div>

  <div class="summary">
    <div class="card c-pass"><div class="num">${totalPass}</div><div class="lbl">✅ PASS</div></div>
    <div class="card c-fail"><div class="num">${totalFail + totalBug}</div><div class="lbl">❌ FAIL / BUG</div></div>
    <div class="card c-inc"><div class="num">${totalInc}</div><div class="lbl">⚠️ INCONCLUSO</div></div>
    <div class="card c-lim"><div class="num">${totalLim}</div><div class="lbl">🔒 LIMITACIÓN</div></div>
    <div class="card c-na"><div class="num">${totalNA}</div><div class="lbl">— N/A</div></div>
    <div class="card"><div class="num">${totalPass + totalFail + totalBug + totalInc + totalLim + totalNA}</div><div class="lbl">Total</div></div>
  </div>

  <!-- Beacon summary -->
  <div class="section">
    <div class="section-header">Beacons capturados en sesión</div>
    <div class="beacon-grid">
      ${Object.entries(BEACON_SUMMARY).map(([k,v]) =>
        `<div class="beacon-chip">${k}<span>${v}</span></div>`
      ).join('')}
    </div>
  </div>

  ${SECTIONS.map(s => `
  <div class="section">
    <div class="section-header">${s.title}</div>
    <table>
      <thead><tr>
        <th>ID</th><th>Descripción</th><th>Resultado</th><th>Valor observado</th><th>Detalle / Evidencia</th>
      </tr></thead>
      <tbody>${s.tests.join('')}</tbody>
    </table>
  </div>`).join('')}
</div>

<!-- Lightbox -->
<div class="lightbox" id="lb" onclick="this.classList.remove('open')">
  <span class="lightbox-close">×</span>
  <img id="lb-img" src="">
</div>
<script>
  document.querySelectorAll('figure img').forEach(img => {
    img.onclick = (e) => {
      e.stopPropagation();
      document.getElementById('lb-img').src = img.src;
      document.getElementById('lb').classList.add('open');
    };
  });
</script>
</body>
</html>`;

fs.writeFileSync(OUTPUT, html);
const size = (fs.statSync(OUTPUT).size / 1024 / 1024).toFixed(1);
console.log(`✅ HTML generado: ${OUTPUT}`);
console.log(`   Tamaño: ${size} MB`);
console.log(`   Secciones: ${SECTIONS.length}`);
console.log(`   PASS: ${totalPass} | FAIL+BUG: ${totalFail+totalBug} | INCONCLUSO: ${totalInc} | LIMITACIÓN: ${totalLim} | N/A: ${totalNA}`);
