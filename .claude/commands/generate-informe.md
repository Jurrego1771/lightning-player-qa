Genera un informe QA profesional en HTML/PDF combinando los resultados automáticos de Playwright con hallazgos manuales adicionales.

## Argumentos

`$ARGUMENTS` contiene hallazgos manuales del tester en texto libre. Pueden ser bugs, observaciones o validaciones del Lightning Player. Ejemplo:
```
Bug medio: en iOS Safari el player no reanuda tras pausa en background.
Observación: el tiempo de inicio en streams HLS es ~4s en conexiones lentas.
Bug crítico: el pre-roll ad no dispara en Firefox cuando autoplay está activo.
```

## Pasos a ejecutar

### 1. Leer resultados de Playwright

Lee `playwright-report/report.json`. Extrae:
- Total de pruebas ejecutadas
- Pruebas pasadas (`status: 'passed'` o `status: 'expected'`)
- Pruebas fallidas (`status: 'failed'` | `'unexpected'` | `'timedOut'`)
- Pruebas saltadas (`status: 'skipped'`)
- Tiempo total (`stats.duration` ms → minutos)
- Proyectos ejecutados (`config.projects[].name`)
- Tests fallidos: título + primeras 120 chars del error

Si el archivo no existe → indicar al usuario que ejecute `npm test` primero.

**Estructura del JSON de Playwright:**
```
report.json
├── stats: { expected, unexpected, skipped, flaky, duration }
├── suites[]                     ← archivos .spec.ts
│   ├── title                    ← nombre del archivo
│   └── suites[]                 ← describe blocks
│       └── specs[]
│           ├── title            ← nombre del test
│           └── tests[]
│               └── results[]
│                   ├── status   ← 'passed'|'failed'|'timedOut'|'skipped'
│                   └── errors[].message
```

### 2. Incorporar hallazgos manuales

Clasifica los hallazgos de `$ARGUMENTS`:
- **Bug crítico** → player no reproduce, crash, pérdida de datos
- **Bug medio** → funcionalidad degradada, workaround disponible
- **Bug menor** → visual o UX menor
- **Observación** → nota técnica, no es bug

Si `$ARGUMENTS` está vacío, omitir sección de hallazgos manuales.

### 3. Traducción para el cliente

| Categoría interna | Traducción cliente |
|---|---|
| Bug crítico | Ajuste prioritario |
| Bug medio | Ajuste identificado |
| Bug menor | Mejora sugerida |
| Observación | Optimización recomendada |

### 4. Generar `playwright-report/qa-report.html`

Usar EXACTAMENTE este HTML base, reemplazando los valores dinámicos indicados con `{{...}}`:

```html
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>QA Report — {{MÓDULO}}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
      background: #f4f6f9;
      color: #1a1a2e;
      padding: 40px 24px;
      line-height: 1.6;
      font-size: 14px;
    }
    .page { max-width: 980px; margin: 0 auto; }
    .header {
      background: linear-gradient(135deg, #0f3460 0%, #16213e 100%);
      color: #fff;
      border-radius: 12px;
      padding: 32px 36px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 24px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.15);
    }
    .brand { display: flex; flex-direction: column; gap: 4px; }
    .brand-label {
      font-size: 0.68rem;
      font-weight: 700;
      letter-spacing: 2.5px;
      text-transform: uppercase;
      color: #00c851;
    }
    .brand-title {
      font-size: 1.9rem;
      font-weight: 800;
      color: #ffffff;
      letter-spacing: -0.5px;
    }
    .brand-sub { font-size: 0.85rem; color: rgba(255,255,255,0.65); margin-top: 2px; }
    .meta-grid { text-align: right; display: flex; flex-direction: column; gap: 4px; }
    .meta-row { font-size: 0.83rem; color: rgba(255,255,255,0.65); }
    .meta-row strong { color: #ffffff; font-weight: 600; }
    .section { margin-bottom: 24px; }
    .section-header {
      font-size: 0.65rem;
      font-weight: 800;
      letter-spacing: 2.5px;
      text-transform: uppercase;
      color: #94a3b8;
      margin-bottom: 10px;
      padding-left: 2px;
    }
    .card {
      background: #ffffff;
      border-radius: 12px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.08);
      border: 1px solid #e2e8f0;
    }
    .summary-card { padding: 22px 28px; border-left: 4px solid #0f3460; }
    .summary-card p { color: #334155; font-size: 0.95rem; line-height: 1.7; }
    .coverage-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
    .coverage-item {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 14px 18px;
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 0.875rem;
      color: #334155;
      box-shadow: 0 1px 2px rgba(0,0,0,0.04);
    }
    .coverage-icon {
      width: 28px; height: 28px;
      background: #f0f4ff;
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 0.9rem; flex-shrink: 0;
    }
    .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
    .stat-card {
      background: #ffffff;
      border: 2px solid #e2e8f0;
      border-radius: 10px;
      padding: 22px 20px;
      text-align: center;
      box-shadow: 0 1px 3px rgba(0,0,0,0.06);
    }
    .stat-card.stat-total  { border-color: #0f3460; background: #f0f4ff; }
    .stat-card.stat-passed { border-color: #00c851; background: #f0fff4; }
    .stat-card.stat-failed { border-color: #dc2626; background: #fff5f5; }
    .stat-card.stat-skipped{ border-color: #d97706; background: #fffbf0; }
    .stat-number { font-size: 3rem; font-weight: 800; line-height: 1; margin-bottom: 6px; letter-spacing: -2px; }
    .stat-number.slate { color: #0f3460; }
    .stat-number.green { color: #00c851; }
    .stat-number.red   { color: #dc2626; }
    .stat-number.amber { color: #d97706; }
    .stat-label { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px; color: #94a3b8; }
    .table-wrap { border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    table { width: 100%; border-collapse: collapse; font-size: 0.875rem; background: #ffffff; }
    thead tr { background: #f0f4ff; }
    thead th {
      text-align: left; padding: 13px 16px;
      font-size: 0.68rem; font-weight: 800;
      text-transform: uppercase; letter-spacing: 1.5px;
      color: #0f3460; border-bottom: 2px solid #dde3f0;
    }
    tbody tr { border-bottom: 1px solid #f1f5f9; transition: background 0.1s; }
    tbody tr:last-child { border-bottom: none; }
    tbody tr:hover { background: #f8fafc; }
    tbody td { padding: 13px 16px; color: #334155; vertical-align: top; }
    tbody td.num { color: #94a3b8; width: 44px; text-align: center; font-weight: 600; }
    tbody td.title { font-weight: 600; color: #0f172a; min-width: 200px; }
    tbody td.detail { color: #475569; line-height: 1.6; }
    .badge {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 4px 10px; border-radius: 99px;
      font-size: 0.7rem; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.5px; white-space: nowrap;
    }
    .badge-critical { background: #fee2e2; color: #b91c1c; }
    .badge-medium   { background: #fef3c7; color: #92400e; }
    .badge-minor    { background: #dbeafe; color: #1d4ed8; }
    .badge-obs      { background: #e8f0fe; color: #0f3460; }
    .badge-ok       { background: #00c851; color: #ffffff; }
    .steps-card { padding: 8px 0; }
    .step-item {
      display: flex; align-items: flex-start; gap: 14px;
      padding: 14px 24px; border-bottom: 1px solid #f1f5f9; color: #334155;
    }
    .step-item:last-child { border-bottom: none; }
    .step-num {
      min-width: 26px; height: 26px;
      background: #0f3460; color: #ffffff;
      border-radius: 50%; display: flex; align-items: center; justify-content: center;
      font-weight: 800; font-size: 0.72rem; flex-shrink: 0; margin-top: 1px;
    }
    .step-text { font-size: 0.9rem; line-height: 1.55; }
    .footer {
      background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px;
      padding: 18px 28px; display: flex; justify-content: space-between;
      align-items: center; font-size: 0.8rem; color: #94a3b8;
      margin-top: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }
    .footer-left { display: flex; align-items: center; gap: 8px; }
    .footer-dot { width: 6px; height: 6px; border-radius: 50%; background: #0f3460; }
  </style>
</head>
<body>
<div class="page">

  <!-- HEADER -->
  <div class="header">
    <div class="brand">
      <span class="brand-label">Informe de calidad</span>
      <span class="brand-title">QA Report</span>
      <span class="brand-sub">{{PRODUCTO}} — {{MÓDULO}}</span>
    </div>
    <div class="meta-grid">
      <div class="meta-row"><strong>Módulo:</strong> {{MÓDULO}}</div>
      <div class="meta-row"><strong>Entorno:</strong> {{ENTORNO}}</div>
      <div class="meta-row"><strong>Fecha:</strong> {{FECHA}}</div>
      <div class="meta-row"><strong>Browsers:</strong> {{BROWSERS}}</div>
    </div>
  </div>

  <!-- ESTADO GENERAL -->
  <div class="section">
    <div class="section-header">Estado general</div>
    <div class="card summary-card">
      <p>{{RESUMEN_EJECUTIVO}}</p>
    </div>
  </div>

  <!-- COBERTURA -->
  <div class="section">
    <div class="section-header">Cobertura</div>
    <div class="coverage-grid">
      {{COVERAGE_ITEMS}}
    </div>
  </div>

  <!-- RESULTADOS -->
  <div class="section">
    <div class="section-header">Resultados</div>
    <div class="stats-grid">
      <div class="stat-card stat-total">
        <div class="stat-number slate">{{TOTAL}}</div>
        <div class="stat-label">Total ejecutadas</div>
      </div>
      <div class="stat-card stat-passed">
        <div class="stat-number green">{{PASSED}}</div>
        <div class="stat-label">Satisfactorias</div>
      </div>
      <div class="stat-card stat-failed">
        <div class="stat-number red">{{FAILED}}</div>
        <div class="stat-label">Fallidas</div>
      </div>
      <div class="stat-card stat-skipped">
        <div class="stat-number amber">{{SKIPPED}}</div>
        <div class="stat-label">Saltadas</div>
      </div>
    </div>
  </div>

  <!-- FALLOS AUTOMÁTICOS (solo si FAILED > 0) -->
  {{#if FAILED > 0}}
  <div class="section">
    <div class="section-header">Fallos detectados</div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th style="width:44px; text-align:center;">#</th>
            <th style="min-width:200px;">Test</th>
            <th style="width:120px;">Proyecto</th>
            <th>Error</th>
          </tr>
        </thead>
        <tbody>
          {{FAILED_ROWS}}
        </tbody>
      </table>
    </div>
  </div>
  {{/if}}

  <!-- HALLAZGOS MANUALES (solo si $ARGUMENTS no está vacío) -->
  {{#if HAY_HALLAZGOS_MANUALES}}
  <div class="section">
    <div class="section-header">Hallazgos identificados</div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th style="width:44px; text-align:center;">#</th>
            <th style="min-width:200px;">Hallazgo</th>
            <th style="width:190px;">Categoría</th>
            <th>Detalle</th>
          </tr>
        </thead>
        <tbody>
          {{HALLAZGO_ROWS}}
        </tbody>
      </table>
    </div>
  </div>
  {{/if}}

  <!-- ESCENARIOS VALIDADOS -->
  <div class="section">
    <div class="section-header">Escenarios validados sin observaciones</div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Escenario</th>
            <th style="width:130px; text-align:center;">Resultado</th>
          </tr>
        </thead>
        <tbody>
          {{PASSED_ROWS}}
        </tbody>
      </table>
    </div>
  </div>

  <!-- SIGUIENTES PASOS -->
  <div class="section">
    <div class="section-header">Siguientes pasos</div>
    <div class="card steps-card">
      {{STEP_ITEMS}}
    </div>
  </div>

  <!-- FOOTER -->
  <div class="footer">
    <div class="footer-left">
      <div class="footer-dot"></div>
      Evidencias: trazas Playwright disponibles en playwright-report/
    </div>
    <div>Generado el {{FECHA}} · Lightning Player QA</div>
  </div>

</div>
</body>
</html>
```

**Valores dinámicos a reemplazar:**
- `{{MÓDULO}}` — área o feature testeada (inferir del nombre de los specs, ej. "Next Episode API")
- `{{PRODUCTO}}` — "Mediastream Lightning Player"
- `{{ENTORNO}}` — leer de `config.projects` o usar "localhost / isolatedPlayer"
- `{{FECHA}}` — fecha actual en formato YYYY-MM-DD
- `{{BROWSERS}}` — lista de proyectos del config (chromium, firefox, webkit)
- `{{RESUMEN_EJECUTIVO}}` — frase de resumen basada en resultados
- `{{COVERAGE_ITEMS}}` — un `<div class="coverage-item">` por tipo de test ejecutado
- `{{TOTAL}}` / `{{PASSED}}` / `{{FAILED}}` / `{{SKIPPED}}` — números de stats
- `{{FAILED_ROWS}}` — filas `<tr>` para tests fallidos
- `{{HALLAZGO_ROWS}}` — filas con badge de categoría cliente
- `{{PASSED_ROWS}}` — filas con specs que pasaron al 100% (máximo 15 — agrupar por suite si hay más)
- `{{STEP_ITEMS}}` — `<div class="step-item">` con pasos de acción

**Badges a usar según categoría:**
- Ajuste prioritario → `<span class="badge badge-critical">Ajuste prioritario</span>`
- Ajuste identificado → `<span class="badge badge-medium">Ajuste identificado</span>`
- Mejora sugerida → `<span class="badge badge-minor">Mejora sugerida</span>`
- Optimización recomendada → `<span class="badge badge-obs">Optimización recomendada</span>`
- Test pasado → `<span class="badge badge-ok">✅ Correcto</span>`

### 5. Generar el PDF

Después de escribir el HTML, ejecuta:
```bash
node scripts/pdf-from-html.js
```

Confirma al usuario:
- HTML: `playwright-report/qa-report.html`
- PDF: `playwright-report/qa-report.pdf`

Si el script falla, indicar alternativa: abrir HTML en browser → Ctrl+P → Guardar como PDF.
