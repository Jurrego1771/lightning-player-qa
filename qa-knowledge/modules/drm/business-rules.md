# DRM — Business Rules

## Reglas de configuración

**BR-DRM-001** — DRM se configura en el objeto `drm` de la respuesta de plataforma (no en runtime)
La config DRM (`serverURL`, `token`, `httpRequestHeaders`) proviene del JSON de la plataforma (`embed.mdstrm.com/{type}/{id}.json`). No es posible configurar DRM después de que `loadConfig` haya retornado — el player no expone métodos para cambiar la configuración DRM post-inicialización. Si se necesita cambiar el DRM, se debe llamar `player.load({ type, id })` con un nuevo contenido.

**BR-DRM-002** — DRM solo se activa para contenido de video — el audio no se protege con DRM
`takeDrmPath = isVideo && (drm.enabled || hasDrmConfig)`. Si el `playerType` es `audio` o `renderAs` es `audio`, el DRM no se activa aunque el JSON de la plataforma incluya configuración DRM. Esta es una restricción de diseño — el audio DRM no está en scope del player.

**BR-DRM-003** — La URL de la license request va al `serverURL` configurado — no hay proxy interno
`getDashProtectionData` construye `protData[keySystemId].serverURL = value.serverURL` directamente. El browser (via el CDM) envía la license request directamente al `serverURL`. No hay proxy ni middleware del player que intercepte o modifique esta request (excepto los headers de auth configurados).

**BR-DRM-004** — `httpRequestHeaders` tiene precedencia silenciosa sobre `token`/`drmToken`
En `getDashProtectionData.js`: si `value.httpRequestHeaders` es un objeto válido, se usa directamente sin agregar `X-AxDRM-Message`. Solo si `httpRequestHeaders` no está presente se convierte `token`/`drmToken` al header `X-AxDRM-Message`. No hay error ni warning si ambos están configurados.

**BR-DRM-005** — El `token`/`drmToken` se envía SIEMPRE como header `X-AxDRM-Message` — no como query param
El token de autenticación DRM se transmite en el header HTTP de la license request, nunca en la URL. Esta es la convención del sistema DRM Axinom (AxDRM) utilizado por la plataforma Mediastream. Si se necesita auth por query param, usar `httpRequestHeaders` con el header correcto del proveedor.

**BR-DRM-006** — `drm.vkeySystem` actúa como filtro exclusivo de key system
Si `drm.vkeySystem` está seteado (no null/undefined), `getDashProtectionData` solo incluye en `protData` el key system que coincide con ese valor. Los demás key systems configurados son ignorados. El `DRMPlugin` setea `vkeySystem` automáticamente con el resultado de `getDRMSupport()`.

## Reglas de selección de stream

**BR-DRM-007** — FairPlay siempre usa HLS — Widevine/PlayReady siempre preferirán MPD sobre HLS
`DRMPluginRunner`: `src = isFairPlay ? hls : (mpd || hls)`. Si el browser tiene FairPlay (Safari), siempre se usa la URL HLS. Si el browser tiene Widevine o PlayReady, se prefiere MPD (DASH), con fallback a HLS si no hay MPD.

**BR-DRM-008** — MediaTailor skipCdn override: si hay `mediaTailorManifestUrl`, se usa esa URL y se ignoran los `candidateUrls`
Cuando `skipMtCdn=true` y se recibe `mediaTailorManifestUrl`, `DRMPluginRunner` usa esa URL directamente como `src`, independientemente del key system detectado. Esta regla existe para que FairPlay se inicialice sobre la URL CMAF de MediaTailor, no sobre el proxy de Mediastream.

**BR-DRM-009** — Google DAI deferred: si `deferSrcForGoogleDAI=true`, el `src` no se setea directamente
`DRMPlugin` pone `src` en `_daiDeferredManifestUrl` (no en `src`). Esto permite que el plugin de Google DAI use el manifest URL de DRM para inicializar el stream DAI. `src` real es `null` hasta que DAI confirme.

## Reglas de detección de key system

**BR-DRM-010** — El orden de detección es Widevine → PlayReady → FairPlay — el primero que responda gana
`getDRMSupport()` prueba los key systems en orden fijo. En browsers que soporten múltiples (ej: Edge con Widevine Y PlayReady), siempre ganará Widevine. FairPlay solo gana si Widevine y PlayReady no están disponibles.

**BR-DRM-011** — Si ningún key system responde, se emite `DRM_NOT_SUPPORTED` y la reproducción es imposible
No hay fallback a contenido no-DRM si `getDRMSupport()` rechaza. El player emite `PlayerInitError('DRM not supported', { data: 'DRM_NOT_SUPPORTED' }, true)` y para.

## Reglas de error

**BR-DRM-012** — Los errores DRM son SIEMPRE fatales (`fatal: true`)
Tanto `DRM_NOT_SUPPORTED` como `DRM_LICENSE_ERROR` se emiten con `fatal: true`. El player no puede recuperarse de un error DRM sin recargar el contenido.

**BR-DRM-013** — El timeout de espera de sesión DAI/MediaTailor es de 5 segundos (no configurable)
`SESSION_WAIT_MS = 5000` es una constante hardcoded en `plugin.jsx`. Después de 5s sin sesión/manifest, `giveUpSession=true` y el plugin procede. No es configurable desde la API pública.

## Reglas de la industria aplicables

**BR-DRM-IND-001** — ClearKey no debe usarse en producción — solo para testing
W3C ClearKey (`org.w3.clearkey`) no provee protección real (las claves se transmiten en claro). Es aceptable únicamente para tests de EME y demos técnicos. El player Mediastream no implementa ClearKey — correcto por diseño.

**BR-DRM-IND-002** — Widevine L3 en browser es el nivel estándar de la industria para SD/HD/FHD
Netflix, Disney+, Prime Video, YouTube Premium usan Widevine L3 en Chrome/Firefox de escritorio. La restricción a L1 (solo para contenido 4K UHD) es una política de los estudios de contenido, no una limitación técnica del browser. Los operadores deben configurar el license server para aceptar L3 en el contexto de browser.

**BR-DRM-IND-003** — El license server es una dependencia externa crítica — debe tener SLA ≥ 99.9%
La indisponibilidad del license server afecta a todos los usuarios del contenido protegido simultáneamente. El player no tiene mecanismo de retry automático. Los operadores deben usar license servers con alta disponibilidad y monitorizar sus uptime y latencia como SLO crítico.

**BR-DRM-IND-004** — FairPlay requiere certificado de servidor — dos endpoints son necesarios (licenseUrl + certificateUrl)
El flujo de autenticación FairPlay de Apple requiere descargar el certificado del servidor antes de que el browser pueda generar el SPC. Si `certificateUrl` no está configurado o no es accesible, FairPlay falla en el paso 1 del handshake, no en la license request.

**BR-DRM-IND-005** — CENC (Common Encryption) permite proteger el mismo stream con múltiples DRM systems
Los streams DASH modernos usan CENC para incluir protección Widevine + PlayReady en el mismo MPD. Esto permite que un solo stream sea reproducido por el CDM disponible en el browser sin necesidad de streams separados. El player ya soporta este patrón via `candidateUrls.mpd` con múltiples key systems en la config.
