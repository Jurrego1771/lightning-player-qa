# Subtitles — Business Rules

## Reglas de formato

**BR-SUB-001** — Solo una pista activa simultáneamente  
Si se activa una segunda pista mientras hay una en `showing`, la primera pasa a `disabled`. El player no permite dos pistas visibles al mismo tiempo.

**BR-SUB-002** — ASS/SSA nunca pasa al dispositivo Chromecast  
Pistas con `.ass` o `.ssa` en el id son filtradas de la lista efectiva cuando hay sesión Cast activa. El usuario no ve la opción ASS mientras está casteando.

**BR-SUB-003** — URLs de subtítulos siempre en HTTPS  
Al inicializar, todos los URLs de pistas se normalizan de `http://` a `https://`. URLs relativas (empiezan con `/`) se dejan tal cual.

**BR-SUB-004** — Con Google DAI, solo VTT del manifiesto HLS  
Cuando DAI está activo, `config.subtitles` se elimina antes del init. No se montan pistas externas. Pistas VTT en el manifiesto sí funcionan.

## Reglas de modo

**BR-SUB-005** — Modos válidos del TextTrack  
Solo `'showing'`, `'hidden'` y `'disabled'` son aceptados. El Proxy ASS rechaza (`return false`) cualquier otro valor.

**BR-SUB-006** — `hidden` ≠ `disabled`  
`hidden`: la pista existe y sus cues están activos (zoom overlay los usa), pero el browser no la renderiza nativamente.  
`disabled`: la pista no procesa cues. Es el estado "off" real.

**BR-SUB-007** — Toggle invierte entre `showing` ↔ `disabled`  
`toggleSubtitle()` invierte el modo entre `showing` y `disabled`. Excepción: en modo zoom + VTT (no ASS), el toggle hace `hidden` ↔ `disabled` (no `showing`) para que el overlay controle el render.

## Reglas de plataforma

**BR-SUB-008** — TV skin preserva `selectedSubtitle` al desactivar  
En skin TV, `selectedSubtitle` nunca se setea `null` al deshabilitar subtítulos. Mantiene la referencia para poder reactivar la misma pista. En web, puede ser `null`.

**BR-SUB-009** — `subtitlechange` silencioso en desactivaciones automáticas  
Desactivaciones iniciadas internamente por el player (cambio de source, destroy, reconfiguración) usan `{ silent: true }` para no disparar `subtitlechange` externamente.

## Reglas de zoom

**BR-SUB-010** — Umbral de zoom para overlay VTT  
Threshold: `zoomScale > 1.001` (`ZOOM_VTT_SUBTITLE_UI_THRESHOLD`).  
Por debajo del umbral: pista nativa en `showing`.  
Por encima: pista nativa en `hidden`, cues en `NativeVttZoomOverlay`.

**BR-SUB-011** — ASS no usa overlay de zoom  
Pistas ASS no se envían al overlay aunque el zoom esté activo. `isAssTrackId()` lo excluye. El renderer `ass-html5` maneja su propio posicionamiento.
