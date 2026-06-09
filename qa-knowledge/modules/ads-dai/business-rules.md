# ads-dai — Business Rules

## Reglas de Stream

**BR-DAI-001** — DAI cambia la URL del stream antes del inicio de la reproducción
El módulo ads-dai reemplaza el src del player con una URL de stream DAI-modificada antes de que el player inicie la reproducción del contenido. No hay un momento en que el player reproduzca el stream "limpio" y luego cambie a uno con ads — el stream DAI es el único stream que se carga. La URL original del contenido se usa solo como backup y como referencia para construir la URL DAI (para live: se appenda `adInsertionGoogleStreamId` al original).

**BR-DAI-002** — El backup stream es obligatorio para Google DAI
Si `ads.googleDAI.backup` no está configurado, el fallback ante error de stream request no puede funcionar. La condición de init del plugin requiere `backupForSdk` para arrancar (`canInit = element && containerUi && (assetKey || assetKeyDash || sourceId) && backupForSdk`). Sin backup configurado, el plugin no inicia en absoluto.

**BR-DAI-003** — DASH tiene prioridad sobre HLS cuando se pasa assetKeyDash y streamFormat=dash
Si `ads.googleDAI.keyDash` está configurado y `streamFormat === 'dash'`, el request usa `assetKeyDash`. Si `streamFormat !== 'dash'`, se usa `assetKey` (HLS) aunque `keyDash` esté presente. Si hay DRM con `vkeySystem` resuelto, el `streamFormat` se deriva de `selectedSrcType` (ignorando la config de `streamFormat`).

**BR-DAI-004** — El contenedor de overlay DAI debe ser un elemento hijo del player
`GoogleDAIRender` monta un `<div>` gestionado por el SDK DAI para renderizar overlays (click-through button, companion ads en algunos casos). Este div usa `dangerouslySetInnerHTML={{ __html: '' }}` para evitar que React interfiera con el contenido que el SDK inyecta. El div se muestra (display: block) durante ad breaks y se oculta (display: none) en contenido.

## Reglas de Eventos y Beacons

**BR-DAI-005** — Los beacons de cuartiles son responsabilidad del SDK DAI, no del player
A diferencia de IMA CSAI donde el player tiene que disparar beacons VAST, en DAI el SDK de Google gestiona todos los beacons de tracking (impression, firstQuartile, midpoint, thirdQuartile, complete) internamente. El player solo recibe los eventos ya procesados por el SDK y los re-emite via internalEmitter. El player no hace requests HTTP de beacons para Google DAI.

Para MediaTailor DAI, el MediaTailorDAIManager sí hace los requests HTTP de beacons directamente al `trackingUrl` de AWS MediaTailor.

**BR-DAI-006** — AD_BREAK_STARTED y AD_BREAK_ENDED definen el período de control del manager
Durante un ad break (entre AD_BREAK_STARTED y AD_BREAK_ENDED), GoogleDAIManager toma control exclusivo del player via `setHandler(this)`. Esto significa que los comandos de seek, pause y play son interceptados por el manager. Los controles de UI también se bloquean via `controls.addOverride(manager)`. Este estado se revierte en AD_BREAK_ENDED.

**BR-DAI-007** — STARTED/COMPLETE delimitan cada ad individual dentro de un break
Un break puede contener múltiples ads (pod). Cada ad individual dispara STARTED al inicio y COMPLETE al final. AD_BREAK_STARTED y AD_BREAK_ENDED delimitan el break completo. El player emite `_adsStarted` en cada STARTED y `_adsComplete` en cada COMPLETE.

## Reglas de vpmute

**BR-DAI-008** — vpmute refleja el estado de mute del player, no el volumen
`vpmute='1'` significa que el ad se reproducirá sin audio (player muted). `vpmute='0'` significa que se reproducirá con audio. Un player con volumen bajo (ej: 0.1) pero no muted envía `vpmute='0'`. Solo cuando `volume === 0` se envía `vpmute='1'`. Este parámetro ayuda a Google Ad Manager a seleccionar el creative más adecuado (video-only vs con audio).

**BR-DAI-009** — replaceAdTagParameters solo se llama cuando el estado de mute cambia
El guard `if (isMuted === this.#_lastMuted) return` evita llamadas redundantes. Si el volumen cambia de 0.8 a 0.5 (sin mute), no se llama replaceAdTagParameters. Solo un cambio de estado muted/unmuted dispara la llamada.

## Reglas de MediaTailor DAI

**BR-DAI-010** — MediaTailor DAI solo aplica a streams live y DVR sin rangos de tiempo
El Guard verifica `isLiveOrDvr && enabled && id && baseSrc && !skipRealDVR`. Donde `skipRealDVR = type === 'dvr' && start && end`. DVR con rangos definidos (cortes de programación) no usa MediaTailor DAI para evitar conflictos con el timeline trimming.

**BR-DAI-011** — MediaTailor DAI con skipCdn+DRM sigue un flujo especial
Cuando `skipCdn=true` y hay DRM configurado, en vez de hacer `setData({ src: manifestUrl })` directamente, el plugin envía `setData({ _mediaTailorManifestUrl: manifestUrl })`. Esto señaliza al DRMPlugin que use esta URL de MediaTailor (en lugar de la URL proxy de Mediastream) para inicializar la licencia de DRM (FairPlay en particular necesita la URL del stream real para el certificate request).

## Reglas de la industria aplicables

**BR-DAI-IND-001** — No mezclar Google DAI con IMA CSAI en el mismo player para el mismo contenido
Google DAI (SSAI) y IMA CSAI son mecanismos mutuamente excluyentes para un stream dado. Si se configura `ads.googleDAI`, el player reproduce el stream con ads server-side. Si se configura `ads.ima`, el player usa client-side insertion. Configurar ambos para el mismo stream causaría inserción doble de ads. El player asume que el operador elige uno u otro.

**BR-DAI-IND-002** — Errores 4xx del servidor DAI indican configuración incorrecta, no deben hacer fallback
Según las best practices de Google Ad Manager, errores HTTP 4xx en el stream request (excepto 429) indican que el assetKey, sourceId, o apiKey están mal configurados. El fallback al backup stream en estos casos daría la ilusión de que la configuración está bien, ocultando el problema real. El comportamiento correcto sería alertar al operador. La implementación actual hace fallback en todos los casos.

**BR-DAI-IND-003** — El stream DAI backup debe ser el mismo contenido sin ads, no una experiencia degradada
El backup stream configurado en `ads.googleDAI.backup` debe ser el stream de contenido original completo (sin ads), no un stream de baja calidad o un mensaje de error. El usuario debe poder seguir viendo el contenido incluso si DAI falla — esta es la propuesta de valor de tener un backup: no interrumpir la experiencia del espectador.

**BR-DAI-IND-004** — Los timestamps del stream DAI no equivalen al tiempo de contenido en streams con ads
Los timestamps en el stream DAI incluyen la duración de los ad breaks. Para calcular el tiempo real de contenido reproducido (content time), se debe restar la duración acumulada de los ads anteriores. Esta distinción es importante para sistemas de analytics, resume de posición, y DVR scrubbing.
