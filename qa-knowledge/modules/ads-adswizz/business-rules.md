# ads-adswizz — Business Rules

Reglas derivadas del código fuente del player y de estándares/prácticas de la industria de monetización de audio digital (AdsWizz, IAB).

## Reglas de activación

**BR-AWZ-001** — AdsWizz solo se activa para contenido de audio
La integración está pensada para radio en vivo, simulcast AM/FM, podcast y audio on-demand. El wrapper común pasa siempre `type='audio'`. No debe activarse el flujo de companion de audio sobre contenido de video.

**BR-AWZ-002** — El companion banner requiere `hasAW === true` Y `afrUrl`
El componente `<Adswizz>` solo se monta cuando `metadata.hasAW` es `true` y existe `adswizz_companion.afrUrl`. Si falta cualquiera de los dos, no hay banner.

**BR-AWZ-003** — La decoración SSAI requiere `edge_data.server` Y `afrUrl`
La reescritura de la URL del stream (SSAI) solo ocurre cuando `adswizz_companion.edge_data.server` y `afrUrl` están presentes. Es una condición independiente de la del banner: puede existir companion sin SSAI si falta el edge server.

## Reglas de reproducción y degradación

**BR-AWZ-004** — El audio nunca se interrumpe por una falla de AdsWizz
Si el SDK no carga (CDN caído, adblock, error de import), `getAdswizzSDK` devuelve `null`, el banner no se monta y el stream se reproduce (con o sin decoración según disponibilidad). Ninguna falla de AdsWizz debe producir un error fatal de reproducción.

**BR-AWZ-005** — La URL reproducida es la URL decorada cuando SSAI está activo
Cuando la sesión se crea con éxito, el stream que se reproduce es la URL con los parámetros de sesión (`es`, `pz`, `listenerid`), no la URL base. Esa decoración es lo que habilita la inserción y el conteo de avisos server-side.

**BR-AWZ-006** — El aviso de audio viene en el stream (SSAI), no lo controla el player
A diferencia de Google IMA (video CSAI), AdsWizz no pausa ni reanuda el contenido para insertar el aviso; el aviso ya está mezclado en el stream por el edge server. El player solo sincroniza el banner companion.

## Reglas del companion banner

**BR-AWZ-007** — El banner aparece solo durante el aviso de audio
El banner pasa a visible (`showingBanner=true`) cuando el SDK dispara `willDisplayListener` y se oculta (`showingBanner=false`) cuando dispara `outOfContextListener`. Por defecto `alwaysDisplayAds=false`: fuera del aviso el contenedor está oculto.

**BR-AWZ-008** — Dimensiones del companion: 300x250 por defecto
El wrapper común monta el banner con `width=300`, `height=250`. El SDK respeta ese tamaño en `setCompanionBannerConfig.size`.

**BR-AWZ-009** — Fallback zone para avisos sin companion
Cuando un aviso de audio no trae banner companion se usa `fallbackZoneId` (`fallbackCompanionZoneId`). Si tampoco hay fallback, el contenedor permanece oculto sin romper el layout.

**BR-AWZ-010** — La sesión se resetea al desmontar el contenedor
Al desmontar el contenedor del banner (`ref → null`) se llama `resetSession()` para liberar la sesión y el polling de metadata.

## Reglas de privacidad y sesión

**BR-AWZ-011** — El listenerId se deriva de cookie (listenerConsent=true)
Actualmente `init` pasa `listenerConsent: true` de forma fija, por lo que el identificador del oyente proviene de cookie. QA y compliance deben validar que exista base legal para este tracking según el cliente (no hay gate de CMP en el código).

**BR-AWZ-012** — La sesión usa Second Metadata Connection cookieless
El player usa `decorateURLAndCreateSession` (no el `decorateURL` simple del SDK) para habilitar la SMC en contextos sin cookies de terceros. Requiere que la AIS tenga activado el flag `set-session-cookie`.

## Reglas de la industria aplicables

**BR-AWZ-IND-001** — El estándar de audio es VAST 4.1+ con `adType=audio`, no DAAST
DAAST fue deprecado por IAB y fusionado en VAST 4.1 (nov 2018). Las campañas y fixtures de avisos de audio deben usar VAST 4.1 o superior con el atributo `adType=audio`. No diseñar contra el esquema DAAST legacy.

**BR-AWZ-IND-002** — En audio SSAI las impresiones se cuentan server-side
El tracking de avisos en SSAI lo realiza el edge server, no el cliente. La verificación de entrega correcta del aviso pasa por confirmar que la sesión se creó y la URL quedó decorada, no por escuchar eventos en el player.

**BR-AWZ-IND-003** — AdsWizz es un proveedor específico; el contrato no es agnóstico
El mercado de DAI de audio incluye TargetSpot y Triton Digital además de AdsWizz, con SDKs y formatos de tracking distintos. La integración del player es específica de AdsWizz (`decorateURLAndCreateSession`, `setCompanionBannerConfig`, params `es`/`pz`/`listenerid`); cambiar de proveedor implicaría otro flujo.

**BR-AWZ-IND-004** — La creación de sesión SSAI es bloqueante por diseño
El primer segmento del stream ya debe traer la decoración, por lo que la creación de sesión ocurre antes del play. La industria recomienda acotar este bloqueo con un timeout y fallback a la URL sin decorar para no penalizar el time-to-first-audio (hoy el player no lo hace — ver AWZ-DEF-001).
