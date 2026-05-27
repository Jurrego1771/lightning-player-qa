# Subtítulos y Captions (Text Tracks)

Feature: Visualización, selección y gestión de subtítulos y captions de accesibilidad (Closed Captions) en el player.

---

## Descripción

El reproductor soporta subtítulos y captions multilingües para garantizar la accesibilidad y cumplir con el estándar **WCAG 2.1 AA** (criterio 1.2.2). La implementación técnica aprovecha la API nativa de navegadores `HTMLTrackElement` y el formato estandarizado **WebVTT (`.vtt`)**, cargando pistas de texto de dos formas:
1. **WebVTT Interno / In-stream**: Embebidos dentro de los manifiestos de transmisión HLS (`#EXT-X-MEDIA:TYPE=SUBTITLES`) o DASH.
2. **WebVTT Externo / Out-of-band**: Archivos `.vtt` externos cargados dinámicamente mediante URLs en la configuración del player.
3. **Captions de Televisión (CEA-608/708)**: Datos embebidos directamente en segmentos de video TS, parseados mediante la variante *full* de `hls.js`.

---

## Archivos clave para QA (src/)

* `src/view/video/` — Componente HTML5 `<video>` donde se inyectan las etiquetas de pista de texto `<track>`.
* `src/controls/` — Lógica que lee las pistas y expone la API de tracks a los menús de la interfaz.
* `tests/e2e/text-tracks.spec.ts` — Suite de pruebas de regresión y cobertura E2E para subtítulos.

---

## API Pública de Text Tracks (Real)

A diferencia de las especificaciones tradicionales, la API del reproductor expone una estructura estándar y orientada al DOM (`TextTrackList`):

```typescript
// Lista indexada de tracks de texto (TextTrackList)
player.textTracks: TextTrack[]
player.textTracks.length: number                 // Cantidad de tracks cargados
player.textTracks[i]: TextTrack                  // Acceso a un track específico
player.textTracks.getTrackById(id: string): TextTrack | undefined

// Estructura de un TextTrack individual:
interface TextTrack {
  id: string;                                    // Identificador único (suele ser la URL del .vtt)
  kind: 'subtitles' | 'captions' | 'descriptions';
  label: string;                                 // Nombre visible en UI (ej: "Español", "English [CC]")
  language: string;                              // Código BCP-47 de idioma (ej: "es-co", "en-us")
  mode: 'showing' | 'hidden' | 'disabled';       // showing = renderizado activo, disabled = inactivo
}

// Eventos Públicos de Subtítulos
player.on('texttrackchange', cb)                 // Se emite al cambiar el 'mode' de cualquier track
player.on('texttrackaddtrack', cb)               // Se emite al agregar dinámicamente un nuevo track
player.on('texttrackremovetrack', cb)            // Se emite al remover un track existente
```

### Funciones Helper en Fixtures de QA (`fixtures/player.ts`)
Para simplificar la automatización, las fixtures de QA proveen abstracciones directas:
* `player.getTextTracks()`: Retorna un listado limpio `{ id, kind, label, language, mode }[]`.
* `player.setTextTrackMode(trackId, mode)`: Modifica programáticamente el modo de la pista de texto.
* `player.waitForTextTracks(count)`: Espera hasta que el número de pistas cargadas sea igual al esperado.

---

## Criterios de Aprobación (QA Acceptance Criteria)

### 1. Inicialización y Selección Automática (Default Language)
* **Carga de Preferencias**: Si la inicialización del player especifica `subtitles.defaultLanguage: 'es'`, el reproductor debe configurar automáticamente el track correspondiente a dicho idioma BCP-47 en modo `'showing'` una vez cargado el contenido.
* **Estado Inactivo por Defecto**: Si no se provee `defaultLanguage`, todas las pistas en `player.textTracks` deben inicializarse estrictamente con el modo `'disabled'`.

### 2. Cambios de Estado y Modos de Visualización
* **Cambio de Modo Inmediato**: Al configurar `track.mode = 'showing'`, la interfaz del reproductor debe comenzar a dibujar el texto en pantalla de forma inmediata. Al cambiar a `'disabled'`, el texto en pantalla debe desaparecer al instante.
* **Emisión de Eventos Única**: Cambiar el modo de una pista debe disparar el evento público `texttrackchange` **exactamente una vez**. Múltiples re-renders internos en React no deben duplicar las emisiones de este evento.
* **Exclusividad**: Solo una pista puede estar en modo `'showing'` de forma simultánea. Al activar el Track B, el Track A previamente activo debe transitar automáticamente a `'disabled'`.

### 3. Sincronización y Navegación (Seek & DVR)
* **Estabilización Post-Seek**: Al realizar un seek programático (`player.seek(t)`) en VOD o Live DVR, los subtítulos WebVTT **deben re-sincronizarse en menos de 1.0 segundos**, renderizando los textos correspondientes al nuevo timestamp sin desfasamientos perceptibles (>500 ms).
* **Persistencia en Pausa**: Al pausar la reproducción, el subtítulo activo correspondiente a la marca de tiempo actual **debe mantenerse dibujado** en pantalla. No debe desaparecer ni parpadear.

### 4. Robustez ante Fallos de Red y CORS
* **Manejo de Errores CORS**: Si un archivo `.vtt` externo falla por problemas de políticas de origen cruzado (CORS) o retorna un estado HTTP `404/500`, el reproductor no debe colapsar. Debe continuar la reproducción del video y desactivar silenciosamente la pista correspondiente.

---

## Tendencias de la Industria y Comparación con Gigantes (Netflix, YouTube, Disney+)

Al validar la experiencia y accesibilidad del reproductor, contrastamos nuestras capacidades con los estándares fijados por líderes globales:

### A. Estilo Personalizado y Contraste (Styling)
* **Estándar de la Industria**: Netflix y Disney+ permiten a los usuarios personalizar el tamaño de fuente, color de texto (blanco, amarillo, cian) y opacidad del fondo de la caja de subtítulos desde un menú del player. Esto asegura el cumplimiento de contraste mínimo de **4.5:1** requerido por WCAG.
* **QA Check**: Verificar que el player aplique estilos CSS dinámicos (o soporte pseudoelementos `::cue`) para garantizar legibilidad frente a fondos muy claros.

### B. Ocultamiento Automático en Comerciales (Ads Isolation)
* **Estándar de la Industria**: Durante la inserción de publicidad de video (anuncios VAST/IMA), **los subtítulos del video principal deben ocultarse automáticamente**. Al finalizar el anuncio, deben restaurarse de inmediato sin requerir acción del usuario. Esto previene la superposición de textos que arruinen la legibilidad del anuncio.
* **QA Check**: Ejecutar un flujo con anuncios pre-roll e intermedios. Asegurar que los tracks transiten a `'hidden'` o `'disabled'` al dispararse `adsContentPauseRequested` y regresen a `'showing'` tras `adsContentResumeRequested`.

### C. Soporte RTL (Right-to-Left)
* **Estándar de la Industria**: Los idiomas de lectura de derecha a izquierda (como Árabe y Hebreo) exigen alineación de texto a la derecha y distribución correcta de la caja contenedora de subtítulos.
* **QA Check**: Inyectar una pista en árabe y validar visualmente (usando las aserciones de regresión visual A9) que la caja de texto y la alineación respondan al formato RTL.

### D. Descripciones de Audio y Captions de Accesibilidad
* **Estándar de la Industria**: Es imperativo distinguir entre **Subtítulos** (traducción de voz únicamente) y **Captions / SDH** (incluye indicadores musicales como `[Música de misterio]` o efectos sonoros como `[Explosión]`). El player debe exponer la propiedad `kind` correcta para guiar a los lectores de pantalla y a usuarios con discapacidad auditiva.
* **QA Check**: Asegurar que las pistas de tipo closed captions tengan el atributo `kind: 'captions'` y las tradicionales `kind: 'subtitles'`.

---

## Riesgos Conocidos para QA

* **Variante Light de Hls.js**: Si la compilación del player usa la versión reducida `hls.js/dist/hls.light.js`, no se incluirá el parser CEA-608 para closed captions embebidos en streams de televisión. Si un test requiere validar subtítulos de transmisiones tradicionales, la suite debe validar que se cargue la versión `full` del handler.
* **Indexación Dinámica**: Las pistas in-stream pueden demorar en ser identificadas por el reproductor hasta que se descargue el primer segmento de manifiesto. Los tests de automatización siempre deben invocar `player.waitForTextTracks()` antes de intentar leer la lista o activar un idioma.
