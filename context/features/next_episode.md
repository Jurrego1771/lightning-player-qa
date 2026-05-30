# Next Episode (Próximo Episodio)

Feature: Autoplay continuo y transición automatizada entre episodios de series o contenidos secuenciales con cuenta regresiva e integración publicitaria.

---

## Descripción

El módulo de **Next Episode (Próximo Episodio)** implementa la lógica de reproducción continua (*binge-watching*) para contenidos seriados (tipo `episode` o `media` que representan series). 

Cuando la reproducción del video actual se aproxima a su final, el reproductor evalúa si existe un episodio consecutivo disponible en los metadatos. De ser así, despliega un cartel interactivo de cuenta regresiva de **5 segundos** que, al expirar, carga y reproduce automáticamente el siguiente episodio utilizando transiciones dinámicas (SPA playback loading) sin necesidad de recargar la página.

El feature está optimizado con dos enfoques de interfaz:
* **Web Skin:** Control clásico con clics en pantalla.
* **TV Skin (`view: 'reels'` o entorno de televisión):** Activa el modo enfocado a control remoto, permitiendo navegación direccional por teclado y teclas rápidas.

---

## Archivos clave para QA (src/)

* `src/view/video/components/nextEpisode/` — Contiene la interfaz visual (.jsx), estilos de televisión (.scss) y el renderizado de la cuenta regresiva.
* `src/view/video/hooks/useNextEpisodeTiming.js` — Calcula dinámicamente cuándo alertar y cuándo mostrar la tarjeta basándose en los segundos restantes y la duración.
* `src/view/video/hooks/useNextEpisodeEvents.js` — Maneja la emisión de eventos de observabilidad hacia la API pública.
* `src/view/video/hooks/useNextEpisodeControls.js` — Bloquea temporalmente el panel de controles nativo del reproductor para evitar interrupciones de reproducción de fondo.
* `src/view/video/hooks/useNextEpisodeLoader.js` — Orquesta la llamada a `api.load()` para cargar dinámicamente el siguiente recurso.
* `tests/contract/player-api-format-param.spec.ts` — Incluye pruebas de inicialización sin parámetros (backward compat) y contratos relacionados a la propagación del estado.

---

## API Pública de Next Episode

El player expone en su interfaz pública (`window.__player`) las siguientes propiedades y métodos específicos para su configuración en caliente y control manual:

```typescript
// Configuración dinámica
player.updateNextEpisode(nextEpisodeData: {
  id: string;                         // ID del siguiente episodio
  type?: 'episode' | 'media';         // Tipo de contenido (default: 'episode')
  nextEpisodeTime?: number;           // Segundos restantes antes del final para activar la UI (default: 30)
}): void

// Estado (Siempre async vía Jotai atoms)
player.metadata: {
  next?: string;                      // ID estático del siguiente episodio cargado por la plataforma
  nextEpisodeTime?: number;           // Tiempo de disparo estático devuelto por la plataforma
  nextEpisodeOverride?: boolean;      // Flag que indica si se inyectó un episodio en caliente
}

// Eventos Públicos de Next Episode
player.on('ready', cb)                      // El reproductor inicializa la API básica
player.on('nextEpisodeIncoming', cb)        // Se emite 5s antes de mostrar el cartel (avisa ID del siguiente video)
player.on('nextEpisodeLoadRequested', cb)   // Se emite en el instante exacto previo a iniciar api.load()
player.on('sourcechange', cb)               // El player cambia exitosamente el stream al siguiente video
```

---

## Señales de observabilidad (eventos, estados)

| Señal | Tipo | Descripción |
|---|---|---|
| `nextEpisodeIncoming` | evento | Emite el ID del siguiente episodio `nextEpisodeTime + 5` segundos antes del final. |
| `nextEpisodeLoadRequested`| evento | Emite el ID del video actual justo antes de disparar la carga del siguiente. |
| `nextEpisodeConfirmed` | evento interno | Sincroniza la UI cuando la aplicación confirma un cambio dinámico del ID. |
| `sourcechange` | evento | Se emite cuando el siguiente video ha cargado y el reproductor cambia de stream. |

---

## Criterios de Aprobación (QA Acceptance Criteria)

Para considerar la feature de Next Episode como **SAFE_TO_MERGE**, se deben cumplir estrictamente los siguientes criterios de aprobación bajo control de QA:

### 1. Inicialización y Autoplay
* **Detección de Tiempos:** El cartel de Próximo Episodio debe aparecer **exactamente** al alcanzar el umbral de segundos configurados (`timeRemaining <= nextEpisodeTime`). Si no se provee un tiempo explícito, debe dispararse a los **30 segundos** antes del final de forma predeterminada.
* **Seguridad de Controles:** Mientras la tarjeta de Next Episode esté visible en pantalla (`isVisible === true`), los métodos de reproducción nativos del player (`play`, `pause` y `currentTime`) deben quedar anulados (retornar `false`). El usuario no debe poder pausar o adelantar el video de fondo desde controles externos o gestos móviles.
* **Auto-reproducción al Finalizar:** Si el usuario no interactúa en los 5 segundos de cuenta regresiva de la tarjeta, el player debe cargar el siguiente video. Si el usuario canceló la tarjeta pero dejó que el video llegue al final real (`ended`), el player debe auto-reproducir el siguiente contenido inmediatamente.

### 2. Soporte en Smart TV (Control Remoto)
* **Skin de TV:** Si el User Agent indica un entorno Smart TV (`isTV === true`), la tarjeta debe renderizar la clase CSS `next-episode--tv`.
* **Foco y Teclado:** El foco visual debe asignarse automáticamente al botón **"Siguiente episodio"** (índice 0).
* **Navegación Direccional:** Presionar flechas izquierda/derecha o arriba/abajo en el control remoto debe alternar el foco de forma limpia entre "Ver créditos" y "Siguiente episodio".
* **Activación de Acciones:** Presionar `Enter` o la barra espaciadora en el botón enfocado debe descartar la tarjeta (si está en "Ver créditos") o cargar el siguiente episodio inmediatamente (si está en "Siguiente episodio").

### 3. Coordinación con Publicidad (Post-roll Ads)
* **Prioridad de la Publicidad:** Si el contenido actual tiene programados anuncios Post-roll (VAST/VMAP), la auto-reproducción **no debe** interrumpir el video antes de la tanda publicitaria. El anuncio Post-roll **debe reproducirse completo**.
* **Comportamiento Pasivo (Autoplay):** Al expirar el countdown de 5 segundos de la tarjeta de Next Episode, **la interfaz visual se oculta**. El player continúa reproduciéndose hasta el final, ejecuta el anuncio Post-roll en su totalidad y, al completarse los comerciales con éxito, carga el siguiente episodio inmediatamente.
* **Comportamiento Activo (Clic en Siguiente):** Si el usuario hace clic **explícitamente** en el botón "Siguiente episodio", se asume una acción voluntaria premium. El reproductor detiene el video e **inicia la carga inmediata del siguiente episodio, saltándose el Post-roll** del video actual.
* **Comportamiento de Cancelación:** Si el usuario presiona "Ver créditos", la tarjeta se descarta de forma permanente. El video principal llega al final, reproduce la tanda publicitaria Post-roll y, al terminar, el player se queda detenido sin avanzar (respetando la decisión de detención del usuario).

### 4. API Dinámica
* **updateNextEpisode:** Llamar a `player.updateNextEpisode({ id: 'new-id' })` a mitad de reproducción debe reescribir inmediatamente los metadatos internos. Al activarse el cartel, debe cargarse el ID `'new-id'`, ignorando por completo el ID estático original devuelto por el backend.

---

## Comparación con la Industria

Al auditar la calidad del feature de Next Episode en el Lightning Player, contrastamos su implementación frente a los líderes del mercado (*Netflix*, *YouTube*, *Prime Video*):

### A. Priorización de Ingresos vs Experiencia del Usuario
* **Estándar de la Industria (Premium Binge-watching):** Los reproductores premium priorizan la experiencia del usuario cuando este realiza una acción interactiva explícita (saltar de inmediato). Sin embargo, bajo autoplay pasivo, reproducen el anuncio Post-roll antes de cambiar de episodio para preservar las métricas de monetización del publisher. Nuestra especificación técnica sigue exactamente este estándar de oro.

### B. Bloqueo Temporal de Controles (Safety Lock)
* **Estándar de la Industria:** Durante los overlays de transiciones (Next Episode, créditos interactivos), las plataformas en Smart TV bloquean los botones primarios del control remoto para evitar que la UI quede desalineada o se congele la cola de reproducción. Lightning Player implementa esto de forma limpia a través de overrides dinámicos en el componente `useNextEpisodeControls`.

### C. Descarte de la Cuenta Regresiva ("Ver Créditos")
* **Estándar de la Industria:** Ofrecer un botón claro para ver los créditos permite que los usuarios disfruten de finales de temporada, canciones de cierre o escenas post-créditos. Al seleccionarlo, la tarjeta se oculta para siempre en el video activo. QA debe verificar que no existan re-disparos de la UI tras haber sido descartada una vez.

---

## Riesgos Conocidos para QA

* **loadedmetadata timeout race (CRITICAL):** Si el player se inicializa en pausa (`autoplay: false`) y el parámetro `format` es omitido en la configuración del player, un bug en `loadConfig.js` / `handler.js` hace que `autoStartLoad` se configure erróneamente en `false`. Como resultado, HLS.js no descarga segmentos, la etiqueta de video se queda en `readyState = 0` (HAVE_NOTHING) y **el evento `loadedmetadata` nunca se dispara**, provocando el fallo y congelamiento de las pruebas de QA que esperan este evento. *Solución: Forzar que `autoStartLoad` sea `true` por defecto en HLS/Native handlers cuando `preloadEnabled` es `undefined`.*
* **Fuga de overrides de controles (Memory leaks):** El hook `useNextEpisodeControls` registra anulaciones temporales en el módulo global de controles. Si el componente se desmonta de forma abrupta debido a un error o destrucción de la instancia sin ejecutar el callback de limpieza (`return () => controls.removeOverride(nextEpisodeOverride)`), el player puede quedar en un estado donde los botones nativos (Play/Pause) quedan bloqueados permanentemente.
* **Interrupción de signs analíticos en Post-rolls:** Al cambiar de video dinámicamente tras un anuncio Post-roll, el player debe asegurar que el tracker de analíticas de ads emita el beacon de finalización completa (`complete` / `allAdsCompleted`) antes de liberar la memoria del video anterior. De lo contrario, se pueden reportar caídas falsas en la tasa de finalización de anuncios (ad completion rate).
