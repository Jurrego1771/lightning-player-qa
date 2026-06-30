# i18n — Business Rules

## Idiomas y soporte

**BR-I18N-001** — Idiomas soportados: `es`, `en`, `pt`  
El sistema solo tiene archivos JSON de traducción para español, inglés y portugués. Cualquier otro código de idioma produce degradación silenciosa (strings como claves crudas). La documentación pública debe indicar explícitamente estos 3 como los únicos soportados.

**BR-I18N-002** — Idioma por defecto: `'es'`  
Cuando `options.language` no se especifica o es `undefined`, el sistema usa `'es'` (español). No se detecta el idioma del browser (`navigator.language`). El player siempre requiere configuración explícita para idioma diferente al español.

**BR-I18N-003** — Namespace asignado por view  
Cada vista del player usa un namespace de traducción diferente:
- `video` → namespace `video` + `default`
- `compact` → namespace `compact` + `default`
- `radio` → namespace `radio` + `default`
- `reels` → namespace `reels` + `default`
- `federation` → namespace `federation`

## Carga y rendimiento

**BR-I18N-004** — Carga lazy por namespace+idioma  
Los archivos JSON de traducción se cargan con dynamic import cuando son necesarios por primera vez. No se pre-cargan todos los idiomas al inicio. Los chunks Webpack generados son uno por combinación de idioma+namespace.

**BR-I18N-005** — Caché en memoria durante la sesión  
Una vez cargado un idioma+namespace, el resultado se cachea en memoria. No hay expiración ni invalidación durante el ciclo de vida del player. Recargar el player limpia la caché.

**BR-I18N-006** — No hay fallback de idioma configurado  
i18next no tiene `fallbackLng` configurado. Si un archivo JSON no existe o falla al cargar, no hay caída automática a otro idioma. El comportamiento de degradación es mostrar la translation key como texto visible.

## Traducciones custom del integrador

**BR-I18N-007** — Traducciones custom solo para namespace `federation`  
El mecanismo de override via `view.federation.translation` solo aplica al namespace `federation`. Otros namespaces (`video`, `compact`, `radio`, `reels`, `default`) no tienen soporte para override de strings.

**BR-I18N-008** — Override de traducciones custom hace deep merge  
Las traducciones del integrador (`view.federation.translation`) se fusionan con el JSON del idioma usando deep merge. Las claves del integrador tienen precedencia sobre las del JSON. Claves no sobreescritas mantienen el valor del JSON.

**BR-I18N-009** — Las traducciones custom deben ser JSON válido en string  
`view.federation.translation` debe ser un string JSON válido. Un JSON malformado se parsea con try/catch y retorna `{}` silenciosamente, sin error visible.

## Strings y claves

**BR-I18N-010** — String vacío retorna como vacío, no como clave  
`returnEmptyString: true` — cuando un campo en el JSON es `''`, `t()` retorna `''`. No se usa la clave como fallback para campos vacíos. Comportamiento diferente al de clave inexistente (donde sí retorna la clave).

**BR-I18N-011** — Clave inexistente retorna la clave como texto  
`missingKeyNoValueFallbackToKey: true` — cuando una clave no existe en el JSON cargado, `t('my.key')` retorna `'my.key'` como texto. El usuario ve la clave cruda. No se lanza error.

**BR-I18N-012** — HTML permitido en strings  
`escapeValue: false` en la configuración de interpolación. Los strings pueden contener HTML válido. Se usa en `federation.json` para links en mensajes de error y registro.

**BR-I18N-013** — Variables con `{{variable}}` en strings de Chromecast  
El namespace `video` usa interpolación de variables en strings de Chromecast:  
`seekBackward`: `"Retroceder {{seconds}} segundos"`.  
Los componentes que usen estos strings deben pasar los valores de las variables como segundo argumento de `t()`.

## Consistencia entre idiomas

**BR-I18N-014** — Paridad de claves entre idiomas  
Todos los archivos JSON de un namespace deben tener las mismas claves en todos los idiomas. Una clave presente en `es/video.json` debe existir en `en/video.json` y `pt/video.json`. La ausencia produce degradación a la clave cruda para ese idioma.

**BR-I18N-015** — El namespace `radio` en inglés no está traducido (defecto conocido)  
Los archivos `en/radio.json` y `es/radio.json` son idénticos y contienen texto en español. Esto es un defecto conocido (I18N-DEF-001) y no el comportamiento esperado según la regla BR-I18N-014.

## Accesibilidad

**BR-I18N-016** — ARIA labels de controles principales deben usar strings i18n  
Los controles TV (play, pause, settings, quality, speed, subtitles, audio) usan strings del namespace `video` via `useTranslation('video')` en `TVAudioSubtitleSidebar`. Los aria-labels de estos controles cambian con el idioma. Excepción: fallbacks de audio track label están hardcodeados (defecto I18N-DEF-002).

**BR-I18N-017** — Los controles de media (progreso, seek) no se invierten para idiomas RTL  
Por convención de industria (confirmada en research de Spotify Engineering), los controles de reproducción y la barra de progreso no se invierten en layouts RTL. El player no implementa soporte RTL — los idiomas RTL (árabe, hebreo) no están en el roadmap actual.
