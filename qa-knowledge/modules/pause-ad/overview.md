# pause-ad — Overview

## Qué hace

El módulo `pause-ad` muestra un anuncio estático sobre el player cuando el usuario pausa voluntariamente la reproducción. A diferencia de los ads lineales (IMA), el pause ad **no usa el IMA SDK** — tiene su propio ciclo de fetch VAST, renderizado React y gestión de estado via Jotai. Se sirve como imagen estática extraída del `staticResource` de la respuesta VAST.

El formato está estandarizado por IAB Tech Lab como parte del **CTV Ad Portfolio** (diciembre 2025). Su característica definitoria es que el contenido sigue pausado mientras el ad está visible — no es un ad lineal que interrumpe, sino uno que aprovecha el estado de pausa iniciado por el usuario.

## Archivos clave

| Archivo | Rol |
|---------|-----|
| `src/view/video/atoms/pauseAd.js` | Atoms Jotai: estado de activación, `pauseAdStartEffectAtom` registra listeners en `_pause` / `_play` |
| `src/view/video/atoms/pauseAdContextAtoms.js` | Parseo de la config de plataforma (`ads.pausead`) hacia los atoms |
| `src/view/video/hooks/usePauseAdTimer.js` | Temporizador de duración y lógica del botón de cierre (duration, close_button) |
| `src/view/video/components/pauseAd/index.jsx` | Componente React: renderiza `<img>` + close button + animación de salida 500ms |
| `src/ads/manager/loader/pauseAdFetch.js` | Fetch del VAST tag del pause ad |
| `src/ads/manager/loader/vast.js` | `extractPauseAdModelFromParsed` — extrae `staticResource`, `impression`, `clickThrough` del VAST |

## Ciclo completo

```
Usuario hace pause (voluntario)
        │
        ▼
_pause event → pauseAdStartEffectAtom
  ├─ firstPlay ocurrido? NO → ignorar
  ├─ isAdsPlaying? SÍ → ignorar (hay ad lineal activo)
  ├─ api.ended? SÍ → ignorar
  └─ request ya en progreso? SÍ → ignorar
        │
        ▼
Resolver tag URL según dispositivo:
  mobile → tag_mobile (fallback a tag si no existe)
  desktop → tag
        │
        ▼
fetchPauseAdVastConfig(tagUrl)
  GET VAST tag → DOMParser → VASTClient
  Busca creativo: ['nonLinear', 'nonlinear', 'non-linear', 'companion']
  Extrae: { staticResource[0], impression[], clickThrough, clickThroughTracking[] }
        │
        ▼
pauseAdShowAtom = true (si staticResource existe y !isAdsPlaying)
        │
        ▼
<PauseAd> renderiza <img src={staticResource[0]} />
  ├─ Posición: center | top | bottom | top-left | top-right | bottom-left | bottom-right
  ├─ Impression tracking: fetch(url, { mode: 'no-cors' }) × cada pixel (una sola vez)
  └─ close_button:
       -1 → X visible inmediatamente
        0 → sin X; solo click en overlay cierra
       N>0 → X visible después de N segundos
        │
        ▼
Desaparece cuando:
  - Usuario hace play (_play event) → inmediato
  - duration expira (si duration > 0) → onComplete()
  - Click en X (close button)
  - Click en overlay/fondo (canCloseOnClickOutside)
  → Animación de salida: 500ms (isExiting state)
  → pauseAdResetAtom
```

## Estructura de config desde plataforma

La plataforma envía la config via `ads.pausead` en el contexto del player:

```js
{
  tag:               null,       // VAST URL desktop (requerido si no hay tag_mobile)
  tag_mobile:        null,       // VAST URL móvil (si null, usa tag como fallback)
  duration:          0,          // Segundos hasta auto-cierre (0 = sin límite)
  duration_mobile:   0,
  position:          'center',   // center | top | bottom | top-left | top-right |
                                 // bottom-left | bottom-right
  close_button:      0,          // -1 = X inmediata; 0 = click outside; N = X tras N seg
  messages: {
    close_text:      null,       // Texto del botón de cierre (null = usar default)
    view_more_text:  null,       // Texto del CTA de click-through
  }
}
```

El campo `schedule[pausead]` en la plataforma (dashboard de ads) mapea directamente a esta estructura.

## Qué extrae del VAST

```js
// extractPauseAdModelFromParsed — vast.js
const PAUSE_AD_CREATIVE_TYPES = ['nonLinear', 'nonlinear', 'non-linear', 'companion']
// → ads[0] → primer creativo de esos tipos → staticResource[0] como URL de imagen
// → impression URLs → clickThrough URL → clickThroughTracking URLs
```

El pause ad es **exclusivamente imagen estática** — no soporta iframe, video ni HTML5 interactivo. El VAST debe tener un `<StaticResource>` con una URL de imagen.

## Diferencias clave respecto al estándar IAB

| Aspecto | IAB / Industria | Lightning Player |
|---------|-----------------|-----------------|
| Delay de aparición | 3–10s (YouTube: 10s exactos) | Inmediato al pause (0s delay) |
| Tipo de creativo | Imagen, video o HTML5 | Solo imagen estática (staticResource) |
| Botón de cierre | No requerido (resume es el dismiss) | Configurable via `close_button` |
| Frecuencia por sesión | 1 por sesión (Max) / no en cada pausa | Sin límite implementado — aparece en cada pause |
| Live content | Excluido por diseño | Técnicamente no hay restricción en código (responsabilidad de config de plataforma) |

## Interacciones con otros sistemas

| Sistema | Tipo de interacción | Impacto QA |
|---------|---------------------|------------|
| `ads-ima` (lineal) | `isAdsPlaying` bloquea el pause ad bidireccional — si hay ad lineal activo, el pause ad no aparece aunque el usuario pause; si arranca un ad lineal mientras el pause ad está visible, el pause ad desaparece | Bug crítico si el bloqueo falla: doble publicidad simultánea |
| `playback-core` | Escucha `Events._pause` y `Events._play` via `internalEmitter` | Si los eventos no se emiten o se emiten en el orden incorrecto, el pause ad puede quedar "colgado" visible durante la reproducción |
| `platform-config` | `ads.pausead.tag` y `ads.pausead.tag_mobile` vienen del backend. Sin estos campos, `pauseAdEnabled === false` y el sistema no activa ningún listener | Config incorrecta = pause ad nunca aparece sin error explícito |
| `controls-api` | Los controles del player (seekbar, botones) siguen visibles mientras el pause ad está activo | El usuario puede resumir desde los controles o desde el click en el overlay |
