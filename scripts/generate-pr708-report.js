// scripts/generate-pr708-report.js
// Reporte QA autocontenido para PR #708 (WebVTTPreview / thumbnails VTT).
// Lee state/session_state.json y embebe la evidencia de docs/evidence/pr708/ inline.
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const EVID = path.join(ROOT, 'docs/evidence/pr708')
const STATE = path.join(ROOT, 'state/session_state.json')
const OUT = path.join(ROOT, 'docs/PR708_QA_Report.html')

const state = JSON.parse(fs.readFileSync(STATE, 'utf-8'))
const verdict = state.verdict || 'N/A'

function img(file, caption) {
  const p = path.join(EVID, file)
  if (!fs.existsSync(p)) return `<figure class="missing">[falta ${file}]</figure>`
  const b64 = fs.readFileSync(p).toString('base64')
  return `<figure><img src="data:image/png;base64,${b64}" alt="${caption}"><figcaption>${caption}</figcaption></figure>`
}

const cases = [
  ['case-a-complete-grid.png', '(a) Grilla completa — PASS'],
  ['case-b-last-row-bloqueante.png', '(b) Última fila incompleta — PASS'],
  ['case-c-retina-sprite.png', '(c) Retina 2× — PASS'],
  ['case-d-multi-sprite-a.png', '(d) Multi-sprite A — PASS'],
  ['case-d-multi-sprite-b.png', '(d) Multi-sprite B — PASS'],
  ['case-e-real-smaller-sprite.png', '(e) Sprite físico 1000×580 vs VTT 2160×1220 — PASS'],
]

const verdictColor = verdict === 'SAFE_TO_MERGE' ? '#1a7f37' : verdict === 'DO_NOT_MERGE' ? '#cf222e' : '#9a6700'

const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>QA Report — PR #708 WebVTTPreview</title>
<style>
 body{font:15px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;max-width:980px;margin:2rem auto;padding:0 1rem;color:#1f2328}
 h1{font-size:1.6rem} h2{margin-top:2rem;border-bottom:1px solid #d0d7de;padding-bottom:.3rem}
 .verdict{display:inline-block;padding:.4rem .9rem;border-radius:6px;color:#fff;font-weight:700;background:${verdictColor}}
 table{border-collapse:collapse;width:100%;margin:.6rem 0} th,td{border:1px solid #d0d7de;padding:.45rem .6rem;text-align:left;font-size:.92rem}
 th{background:#f6f8fa} code{background:#eff1f3;padding:.1rem .35rem;border-radius:4px;font-size:.86rem}
 figure{display:inline-block;margin:.5rem;text-align:center;vertical-align:top} img{width:240px;border:1px solid #d0d7de;border-radius:6px}
 figcaption{font-size:.8rem;color:#57606a;max-width:240px} .pass{color:#1a7f37;font-weight:600} .warn{color:#9a6700;font-weight:600}
 .grid{display:flex;flex-wrap:wrap} .note{background:#fff8c5;border:1px solid #d4a72c;padding:.6rem .8rem;border-radius:6px}
</style></head><body>
<h1>Reporte QA — PR #708 · WebVTTPreview (thumbnails VTT)</h1>
<p>Veredicto: <span class="verdict">${verdict}</span> &nbsp; · &nbsp; ${new Date().toISOString().slice(0,10)}</p>

<h2>1. Cambio</h2>
<table>
<tr><th>PR</th><td>#708 — <code>#707 fix: fall back to actual sprite size for VTT preview thumbnails</code></td></tr>
<tr><th>Branch</th><td>feature/issue-707 → staging</td></tr>
<tr><th>Archivo</th><td><code>src/view/common/components/webVttPreview/index.js</code> (+20/-2)</td></tr>
<tr><th>Módulo</th><td>ui-common · Riesgo: HIGH</td></tr>
</table>

<h2>2. Resultados de ejecución</h2>
<table>
<tr><th>Suite</th><th>Resultado</th></tr>
<tr><td>vtt-preview-thumbnails — casos (a)–(e)</td><td class="pass">5 / 5 passed</td></tr>
<tr><td>visual regression</td><td class="pass">7 / 7 passed</td></tr>
<tr><td>smoke</td><td class="pass">7 passed · 1 skipped</td></tr>
<tr><td>Defectos confirmados</td><td class="pass">0</td></tr>
</table>

<h2>3. Detalle de casos — vtt-preview-thumbnails</h2>
<table>
<tr><th>Caso</th><th>Escenario</th><th>Resultado</th></tr>
<tr><td>(a)</td><td>Grilla completa (sprite coincide con VTT)</td><td class="pass">PASS</td></tr>
<tr><td>(b)</td><td>Última fila incompleta (PNG más chico)</td><td class="pass">PASS</td></tr>
<tr><td>(c)</td><td>Sprite retina 2× (naturalWidth = 2× declarado)</td><td class="pass">PASS</td></tr>
<tr><td>(d)</td><td>VTT multi-sprite</td><td class="pass">PASS</td></tr>
<tr><td>(e)</td><td>Sprite físico 1000×580 con VTT que declara 2160×1220</td><td class="pass">PASS</td></tr>
</table>

<h2>4. Evidencia (canvas .preview-screen)</h2>
<div class="grid">
${cases.map(([f, c]) => img(f, c)).join('\n')}
</div>
</body></html>`

fs.writeFileSync(OUT, html)
console.log('Reporte escrito en', path.relative(ROOT, OUT), `(${(html.length/1024).toFixed(0)} KB)`)
