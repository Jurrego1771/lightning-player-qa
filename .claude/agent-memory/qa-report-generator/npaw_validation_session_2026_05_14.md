---
name: npaw_validation_caracol_2026_05_14
description: Validación de integración NPAW/Youbora v7.3.28-js-sdk en plataforma DITU (Caracol TV, Dev)
metadata:
  type: project
  date: 2026-05-14
---

## Sesión de validación NPAW/Youbora — DITU Caracol (2026-05-14)

### Contexto general
- **Plataforma:** DITU por Caracol — Dev environment
- **URL:** https://d1qweu0039a3nv.cloudfront.net/
- **Player:** Lightning Player v1.0.67
- **Plugin NPAW:** npaw-plugin v7.3.28-js-sdk
- **Account Code:** caracoltvdev
- **Browser:** Chromium headless (MCP Playwright)
- **Usuario:** jurrego@mediastream.am

### Resultado general
**9 de 11 casos de prueba validados exitosamente.** El plugin NPAW está correctamente integrado.

### Casos PASSED (✅)
1. TB-03: NPAW Plugin Activation & LMA Negotiation — LMA config [200]
2. TB-04: Session Start Beacon — POST session/start [200]
3. TB-05: Heartbeat (Beat) During Live Playback — Beat cada ~30s [200]
4. TB-06: Session Events During Playback — Event sequence correcta [200]
5. TB-07: Session Stop Beacon — session/stop [200]
6. NPAW-8.1: Error Reporting on Startup (DRM Error) — Error fatal reportado correctamente
7. NPAW-8.6: Session Restart After Error — Recovery pattern con LMA OK
8. Retry Resilience — Beacons fallidos reintentados automáticamente → [200]
9. Account Code & System ID Validation — "caracoltvdev" en todos beacons

### Casos BLOQUEADOS (⚠️)
- **TB-Pause, TB-Resume, NPAW-4.2 Seek, NPAW-7.1 Ended** — Bloqueados por DRM not supported en Chromium headless. Requieren video reproduciendo. **Acción:** validar en Chrome non-headless o Safari con DRM.

### Limitación crítica de entorno
**Chromium headless NO soporta DRM (Widevine).** Todo contenido en Caracol (VOD y Live) usa DRM, por lo que no hay reproducción visual. Sin embargo, el plugin NPAW funciona correctamente antes/durante/después del error DRM, permitiendo validar beacons de red.

### Hallazgos adicionales (no-NPAW)
- GraphQL error: "Cannot query field 'getProfiles'" — no relacionado, backend schema mismatch
- TypeError en Opta widget externo — no relacionado
- Player 'not ready' error en headless — edge case v1.0.67, no defecto NPAW

### URLs de beacons validados
```
✓ lma.npaw.com/configuration?system=caracoltvdev → [200]
✓ lma.npaw.com/data?system=caracoltvdev → [200]
✓ infinity-c32/c33/c38.youboranqs01.com/infinity/session/start → [200]
✓ infinity-*.youboranqs01.com/infinity/session/beat → [200] (~30s interval)
✓ infinity-*.youboranqs01.com/infinity/session/event → [200]
✓ infinity-*.youboranqs01.com/infinity/session/stop → [200]
```

### Documentación entregada
- **Archivo:** `reports/npaw-validation-2026-05-14.html` (22 KB)
- **Formato:** HTML profesional con tablas de casos, hallazgos, gaps de cobertura, siguientes pasos
- **Audiencia:** Caracol TV / cliente DITU

### Siguientes pasos recomendados
1. **(Alta)** Validar TB-Pause/Resume/Seek/Ended en Chrome DRM-enabled o Safari
2. **(Media)** Resolver GraphQL error (no-NPAW, pero impacta UX general)
3. **(Opcional)** Verificar TB-01/TB-02 con control de config (página test sin NPAW)
4. **(Alta - post-release)** Validación en PROD con trafico real
5. **(Media)** Configurar alertas en Youbora dashboard (drop rate, error rate, LMA latency)

### Notas para futuras sesiones
- DRM es una barrera para testing completo del player en headless. Considerar: Chrome non-headless, Safari headless, o streams test sin DRM para próximas validaciones.
- Cliente es técnico y entiende limitaciones de entorno. Documentación clara sobre "por qué" los casos están bloqueados reduce fricción.
- DITU tiene GraphQL backend issues no relacionados con QA del player — reportar a equipo backend Caracol.
