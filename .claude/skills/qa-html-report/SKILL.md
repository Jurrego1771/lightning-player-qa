---
name: qa-html-report
description: Genera reportes HTML de QA para Lightning Player con el sistema de diseño estándar del proyecto (scrubber de validación, tipografía monospace, acento verde "pasó"). Usar SIEMPRE que se pida un reporte HTML de resultados de tests, validación de un PR, o resumen de una corrida de Playwright.
---

# QA HTML Report — Lightning Player

Sistema de diseño fijo para todos los reportes HTML de QA. **No reinventar el estilo en cada reporte**: parte de `template.html` (en este mismo directorio) y rellena los datos. Los estilos ya fueron aprobados — mantenerlos idénticos salvo que el usuario pida lo contrario.

## Cuándo usar

- "crea un report html", "genera el reporte del PR", "resumen de la corrida en HTML".
- Tras un run de Playwright cuando se quiere comunicar resultados visualmente.

## Flujo

1. **Copia `template.html`** a `docs/<REF>_QA_Report.html` (ej. `docs/PR747_QA_Report.html`).
2. **Obtén datos reales del run** — no estimes. Corre con reporter JSON y parsea por `status`:
   - `expected` = pasó · `unexpected` = falló · `skipped` · `flaky`.
   - El JSON del reporter del proyecto trae preámbulo (health-check) antes del `{` — recórtalo: `raw[raw.index('{'):]`.
   - Python en Windows no resuelve el `/tmp` de git-bash: copia los JSON al scratchpad antes de parsear, o usa rutas Windows.
3. **Rellena** placeholders `{{…}}`: headline, lede, meta (rama/build/motor/fecha), grupos y filas. Una fila por test, agrupadas por spec/área.
4. **Verifica el render**: `file://` está bloqueado en el navegador MCP → sirve por HTTP (`python -m http.server <port>` en `docs/`) y toma screenshot a pantalla completa. Revisa la imagen antes de declarar hecho.
5. Limpia temporales (screenshot, server).

## Regla de contenido por defecto

**Incluir solo los tests que pasaron** (`expected`). **No incluir ni mencionar** flaky, fallidos, ni los excluidos por defecto de test/entorno — a menos que el usuario pida explícitamente un reporte completo. Por eso el scrubber va siempre al 100%.

Si el usuario pide incluir fallos, añade un grupo con un estado distinto (usar el azul `--blue` o un rojo derivado, **nunca** el verde `--pass`, que está reservado a "pasó").

## Sistema de diseño (no alterar sin pedido)

- **Tesis/hero**: un *scrubber* de reproducción al 100% — metáfora del seek bar del player. Es la firma del reporte.
- **Tipografía**: monospace-forward (`--mono`) para títulos, labels, datos y código (lenguaje de un test runner); sans (`--sans`) solo para prosa. Sin fuentes externas (CSP/`file://`-safe) — solo stacks del sistema.
- **Color**: superficie gris-azulada clara; **verde esmeralda `#0B8C5A` reservado exclusivamente al estado "pasó"** (checks, conteos, fill); azul `#3A5BD9` para estructura (eyebrow, foco, enlaces). No agregar un tercer acento.
- **Movimiento**: un solo momento orquestado — el fill del scrubber 0→100% al cargar. Respeta `prefers-reduced-motion`. No añadir más animaciones.
- **Layout**: ancho máx. 920px; tarjetas con borde `--line` y radio 12-14px; grupos = secciones con header (título mono + conteo verde + nombre de spec) y filas con check.

<palette_commit>
frame:  light / cool-gray-blue
ground: #EBEEF4
text:   #161B26
accent: #0B8C5A
accent-2: #3A5BD9
</palette_commit>

## Referencia

`docs/PR747_QA_Report.html` es el primer reporte construido con este sistema — úsalo como ejemplo concreto de relleno.
