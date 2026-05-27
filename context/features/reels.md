# Reels (Playback Vertical)

Feature: Reproducción vertical de videos de corta duración (Short-form / Vertical Playback) en formato Reels mediante un deslizador infinito (vertical swiper).

---

## Descripción

El módulo de **Reels** adapta el reproductor para ofrecer una experiencia inmersiva móvil en formato vertical (relación de aspecto 9:16). Activa un contenedor con un Swiper vertical infinito que permite navegar entre videos individuales y tarjetas publicitarias nativas (*ad cards*), optimizado para una reproducción fluida, carga rápida y navegación táctil o programática.

Para activar este modo en el player, se utiliza la siguiente configuración en la inicialización:
* `type: 'media'` (tipo de contenido genérico).
* `view: 'reels'` (fuerza la skin de UI vertical y los controles de Reels).

*Nota: El valor `type: 'reels'` NO existe en la configuración del player. La vista se configura estrictamente en el campo `view`.*

---

## Archivos clave para QA (src/)

* `src/view/reels/` — Contiene toda la interfaz del swiper, controles táctiles y la lógica de renderizado del feed de reels.
* `src/view/reels/utils/adsManager.js` — Gestiona la frecuencia e inyección de tarjetas de publicidad inline.
* `src/metadata/exposeMetadata.js` — Deduplica y expone metadatos a la API pública.
* `tests/e2e/reels-playback.spec.ts` — Suite de pruebas de regresión y cobertura E2E para Reels.

---

## API Pública de Reels

El player expone a través de su API pública (`window.__player`) los siguientes métodos y propiedades específicos para la interacción y automatización del formato Reels:

```typescript
// Navegación programática
player.goNext(): void                 // Desliza al siguiente Reel (Swiper.slideNext())
player.goPrevious(): void             // Regresa al Reel anterior (Swiper.slidePrev())

// Estado y Metadatos (Siempre asíncronos vía Jotai atoms)
player.metadata: {
  id: string;                         // ID del reel activo (ID real de plataforma o sintético si es Ad Card)
  type?: 'media';                     // Ausente en tarjetas publicitarias (Ad Cards)
  title: string;                      // Título del contenido
  description?: string;               // Descripción detallada
  playerType: 'reels';                // Identificador fijo del tipo de player activo
}

// Eventos Públicos de Reels
player.on('ready', cb)                // El feed de Reels está listo y el reproductor inicializado
player.on('playing', cb)              // El reel activo ha iniciado su reproducción real
player.on('metadatachanged', cb)      // El elemento activo cambió y se emiten los nuevos metadatos
player.on('error', cb)                // Ocurrió un error en la carga del manifiesto de un reel
```

---

## Criterios de Aprobación (QA Acceptance Criteria)

Para considerar la feature de Reels como **SAFE_TO_MERGE**, cada PR que modifique este módulo debe cumplir estrictamente con los siguientes criterios de aprobación:

### 1. Inicialización y Autoplay
* **Autoplay Activado**: Al cargar el player con `autoplay: true`, el primer reel debe alcanzar el estado `playing` de forma automática en menos de **3.0 segundos** (en condiciones normales de red).
* **Autoplay Desactivado**: Con `autoplay: false`, el player debe inicializarse en estado `ready` sin arrojar errores visuales ni excepciones en consola. El primer frame debe renderizarse estático esperando interacción del usuario.

### 2. Navegación e Interacción (Swipes)
* **Consistencia de ID**: Al invocar `player.goNext()` o realizar un swipe táctil hacia abajo, `player.metadata.id` debe cambiar y reflejar un ID único de contenido.
* **Consistencia de Estado**: Al cambiar de video, la reproducción del video anterior debe detenerse por completo (liberando memoria) y el nuevo video debe reproducirse automáticamente.
* **Límite de Historial (Deduplicación de Metadatos)**: Durante los re-renders internos de la UI o transiciones de carga, el evento `metadatachanged` **no debe dispararse de forma duplicada**. Se debe garantizar una única emisión de metadatos por cada cambio de reel real mediante la deduplicación de Lodash `isEqual`.

### 3. Tarjetas Publicitarias Inline (Ad Cards)
* **Frecuencia de Anuncios**: Los anuncios no deben saturar al usuario. La frecuencia está regulada por la propiedad `ads.interval` (obtenida del player config), la cual debe aplicar un mínimo estricto de **4 reels orgánicos** entre cada anuncio (`Math.max(interval, 4)`).
* **Estructura del Payload**: Las tarjetas publicitarias (*ad cards*) deben identificarse de forma determinista mediante la ausencia de la propiedad `type` en `player.metadata` y por un ID sintético que empiece por `ad-` (ej. `ad-1_1716766440`).
* **Estabilidad Post-Anuncio (Issue-627)**: Al deslizar después de una tarjeta publicitaria (*ad card*) hacia el siguiente reel real, los metadatos completos del contenido orgánico (título, descripción, ID de plataforma) **deben emitirse y dibujarse en pantalla sin quedar en blanco o con datos residuales del anuncio**.

---

## Comparación con la Industria 

Al auditar la calidad del producto, debemos contrastar el comportamiento de nuestra feature frente a los líderes del mercado (*TikTok*, *YouTube Shorts*, *Instagram Reels*) en aspectos críticos:

### A. Comportamiento de Bucle (Looping)
* **Estándar de la Industria**: Los videos cortos son repetitivos por naturaleza. Al llegar al final (`ended`), el video activo **debe reiniciarse automáticamente desde el segundo 0** de forma infinita, en lugar de avanzar al siguiente video (a menos que el player esté configurado explícitamente en modo playlist continua).
* **QA Check**: Verificar que el evento `ended` active de inmediato un seek(0) y `play()`, y que el estado transite fluidamente sin destellos negros en pantalla.

### B. Precarga y Buffer Anticipado (Pre-fetching)
* **Estándar de la Industria**: Para lograr navegación instantánea (0 segundos de espera al hacer swipe), los reproductores modernos precargan el manifiesto HLS/DASH y los primeros **2 a 3 segundos** de los siguientes **1 o 2 videos del feed** en segundo plano.
* **QA Check**: Monitorear las solicitudes de red en la pestaña Network. Al estar reproduciendo el Reel N, el player debe iniciar conexiones silenciosas para descargar segmentos de Reel N+1.

### C. Estado de Volumen y Silencio Global (Muted State)
* **Estándar de la Industria**: Si el usuario silencia (mute) un reel, **todos los reels siguientes deben iniciar silenciados**. Si el usuario activa el sonido en el reel N, el reel N+1 debe iniciar reproduciéndose con sonido. El estado de volumen debe persistir durante toda la sesión de navegación del feed.
* **QA Check**: Cambiar el volumen en el player y realizar varios swipes. Validar que la propiedad `player.volume` y el estado nativo de la etiqueta de video se mantengan idénticos a través de los slides.

### D. Métricas de Engagement y Loops
* **Estándar de la Industria**: Los beacons analíticos en formato Reels no solo rastrean play/pause tradicionales. Deben trackear de forma especializada:
  * **Loop Count**: Cuántas veces completó el bucle un mismo video.
  * **Retention/Watch Time**: Tiempo exacto de permanencia en el reel antes del swipe.
  * **Swipe Velocity / Skips**: Si el video fue descartado en menos de 2 segundos (indica contenido no relevante).
* **QA Check**: Validar que los beacons enviados a `track.mdstrm.com` contengan propiedades adicionales indicando el número de bucle actual y el tiempo de permanencia preciso.

---

## Riesgos Conocidos para QA

* **Incompatibilidad en WebKit (CRITICAL)**: La reproducción de video y actualización de metadatos en Reels presenta retrasos severos y fallos de renderizado en navegadores basados en WebKit (Playwright WebKit / Safari). Los tests de integración complejos de Reels deben configurarse como `test.skip` en entornos WebKit, validando su consistencia únicamente en Chromium, Firefox y dispositivos Chrome móviles simlados.
* **Timing de React en Ads**: El componente `AdsManager` inyecta dinámicamente las ad cards. En condiciones de red inestables, el componente puede demorar la actualización de metadatos. En los tests de Playwright, siempre se debe añadir un pequeño retardo de estabilización (~400 ms) o usar aserciones con polling antes de validar la presencia o ausencia de campos en `player.metadata`.
* **Feed al Límite**: Si el feed tiene pocos elementos, llamar a `player.goNext()` en el último elemento puede provocar un comportamiento *no-op* o dejar la interfaz congelada. Siempre asegurar un feed mínimo de 10 elementos en los entornos de prueba mockeados.
