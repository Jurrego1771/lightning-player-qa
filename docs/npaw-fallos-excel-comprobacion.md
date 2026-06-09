# NPAW QA 2026_04 — Comprobación de Fallos Reportados

Fuente: `NPAW QA 2026_04 - Caracol TV_ Web-Mediastream.xlsx`  
Fecha revisión: 2026-06-05  
Player: lightning-player develop

---

## Leyenda

| Estado test | Significado |
|---|---|
| ✅ PASS | Test existe y pasa |
| ❌ FAIL | Test existe y falla |
| ⚠️ PARCIAL | Test cubre parte del caso |
| 🚫 SIN TEST | No hay test automatizado |
| 🔒 LIMITATION | Limitación de diseño, no testeable |
| 🔧 FIXME | Test existe pero marcado como pendiente de implementar |

---

## Fallos reportados en el Excel

### 1.4 — Change Video/Channel Manually

| Campo | Valor |
|---|---|
| **Sección** | Playback básico |
| **Descripción** | Manual changing of channels or content during playback |
| **Pasos** | Play any video → Select a different video content while playing |
| **Resultado Excel** | LIMITATION · CRITICAL |
| **Comentario Excel** | UI doesn't allow to select a different content while one is being reproduced |
| **Test en repo** | 🚫 SIN TEST |
| **Conclusión** | Limitación de la UI del player. No hay selector de contenido expuesto durante reproducción. No testeable automáticamente en el estado actual. |

---

### 2.17 — userType / username en /start

| Campo | Valor |
|---|---|
| **Sección** | Content Metadata |
| **Descripción** | user.type y user.name deben aparecer en el beacon /start cuando el usuario está autenticado |
| **Resultado Excel** | FAILED |
| **Comentario Excel** | Not reported |
| **Test en repo** | `tests/integration/youbora.spec.ts` · `NPAW-2.17a`, `NPAW-2.17b`, `NPAW-2.17c` |
| **Resultado test** | ❌ FAIL (3/3) |
| **Detalle fallo** | `user.type` es `null` en el beacon `/start` aunque `customer_extras.type: 'premium'` está en la config. En retry: beacon `/start` no llega en 20s. El contextMapper del player no está mapeando `customer_extras.type` → `user.type`. |

---

### 7.2 — Video changed by user interaction

| Campo | Valor |
|---|---|
| **Sección** | Session / View management |
| **Descripción** | Play any video and select a different content to be played — /stop debe enviarse al cerrar la primera view |
| **Resultado Excel** | LIMITATION · CRITICAL |
| **Comentario Excel** | UI doesn't allow to select a different content while one is being reproduced |
| **Test en repo** | 🚫 SIN TEST |
| **Conclusión** | Misma limitación que 1.4. La UI no expone selector de contenido durante la reproducción. |

---

### A.2.2 — /adManifest · breaksTime

| Campo | Valor |
|---|---|
| **Sección** | Ads |
| **Descripción** | El parámetro `breaksTime` en /adManifest corresponde con los ad breaks servidos |
| **Resultado Excel** | FAILED |
| **Comentario Excel** | Not reported |
| **Test en repo** | ⚠️ PARCIAL — `NPAW-A.2.6` cubre que `ad.breaksTime` se configura en `setVideoOptions` antes de `fireBreakStart`, pero no valida el valor exacto en el beacon |
| **Resultado test** | Pendiente de ejecutar |

---

### A.2.4 — /adManifest · expectedPattern

| Campo | Valor |
|---|---|
| **Sección** | Ads |
| **Descripción** | El parámetro `expectedPattern` en /adManifest corresponde con el patrón de breaks y ads |
| **Resultado Excel** | FAILED |
| **Comentario Excel** | Not reported |
| **Test en repo** | ⚠️ PARCIAL — `NPAW-A.2.6` cubre que `ad.expectedPattern` se pasa, pero no valida el valor en el beacon |
| **Resultado test** | Pendiente de ejecutar |

---

### A.2.13 — /adStart · skippable

| Campo | Valor |
|---|---|
| **Sección** | Ads |
| **Descripción** | El parámetro `skippable` en /adStart es `true` cuando el ad es saltable |
| **Resultado Excel** | FAILED |
| **Comentario Excel** | Not reported, or field reported as null |
| **Test en repo** | 🚫 SIN TEST (ad-beacons.spec.ts cubre `isAdSkippable()` del player pero no el parámetro NPAW en /adStart) |
| **Conclusión** | Gap de cobertura NPAW para el campo skippable en el beacon /adStart |

---

### A.2.16 — /adStart · adResource

| Campo | Valor |
|---|---|
| **Sección** | Ads |
| **Descripción** | `adResource` en /adStart corresponde con el recurso del anuncio |
| **Resultado Excel** | FAILED |
| **Comentario Excel** | Reported as null |
| **Test en repo** | 🚫 SIN TEST |
| **Conclusión** | BUG-6 conocido: `api.ad.info` del player no expone `adResource`. Bug del player, no del tracker NPAW. |

---

### A.2.17 — /adStart · adTitle

| Campo | Valor |
|---|---|
| **Sección** | Ads |
| **Descripción** | `adTitle` en /adStart corresponde con el título del anuncio |
| **Resultado Excel** | FAILED |
| **Comentario Excel** | Reported as null |
| **Test en repo** | 🚫 SIN TEST |
| **Conclusión** | BUG-6 conocido: `api.ad.info` del player no expone `adTitle`. Bug del player. |

---

### A.2.19 — /adStart · adProvider

| Campo | Valor |
|---|---|
| **Sección** | Ads |
| **Descripción** | `adProvider` en /adStart corresponde con custom dimensions del cliente |
| **Resultado Excel** | FAILED |
| **Comentario Excel** | Reported as null |
| **Test en repo** | 🚫 SIN TEST |
| **Conclusión** | BUG-6 conocido: `api.ad.info` del player no expone `adProvider`. Bug del player. |

---

### A.2.23 — /adStop · adSkipped

| Campo | Valor |
|---|---|
| **Sección** | Ads |
| **Descripción** | `adSkipped` en /adStop es `true` al saltarse un ad skippable |
| **Resultado Excel** | FAILED |
| **Comentario Excel** | Not reported |
| **Test en repo** | `tests/integration/youbora.spec.ts` · `NPAW-A.2.23` |
| **Resultado test** | ❌ FAIL |
| **Detalle fallo** | `Player is not ready. Wait for ready event` — el test llama a `player.play()` antes de que el player esté listo. Problema de timing en el test (falta `waitForReady()` antes de `play()`), no un bug del player. |

---

### A.3.1 — Background durante ad

| Campo | Valor |
|---|---|
| **Sección** | Ads |
| **Descripción** | App puesta en background mientras se reproduce un ad |
| **Resultado Excel** | FAILED |
| **Comentario Excel** | Scenario 1 keeps happening: View doesn't remain open if we move the tab to PIP |
| **Test en repo** | 🔧 FIXME — `NPAW-A.3.1` existe pero marcado `fixme` (requiere Page Visibility API mock) |
| **Conclusión** | Pendiente de implementar. El comportamiento en PIP/background con ads es un gap conocido. |

---

### A.3.3 — /adBufferUnderrun durante ad

| Campo | Valor |
|---|---|
| **Sección** | Ads |
| **Descripción** | Red restringida durante ad → se emite `adBufferUnderrun` al reanudar |
| **Resultado Excel** | FAILED |
| **Comentario Excel** | /bufferUnderrun event created. Not /adBufferUnderrun event appearing |
| **Test en repo** | 🚫 SIN TEST |
| **Conclusión** | Gap real: el player emite `/bufferUnderrun` genérico durante ads en lugar de `/adBufferUnderrun`. Bug del tracker NPAW o del adapter. |

---

### A.4.1 — /adBuffer · adBufferDuration

| Campo | Valor |
|---|---|
| **Sección** | Ads |
| **Descripción** | `adBufferDuration` en /adBufferUnderrun corresponde con el tiempo de buffering del ad |
| **Resultado Excel** | FAILED |
| **Comentario Excel** | /bufferUnderrun event created. Not /adBufferUnderrun event appearing |
| **Test en repo** | 🚫 SIN TEST |
| **Conclusión** | Mismo root cause que A.3.3 — el evento correcto no se emite, por tanto este campo tampoco puede validarse. |

---

### A.5.1 — /adError · ad redirect al inicio

| Campo | Valor |
|---|---|
| **Sección** | Ads — Error handling |
| **Descripción** | Ad falla por redirect al inicio → /adError con errorCode y errorMsg |
| **Resultado Excel** | FAILED |
| **Comentario Excel** | /error event sent. No /adError appearing |
| **Test en repo** | 🚫 SIN TEST |
| **Conclusión** | Gap real: el player emite `/error` genérico en lugar de `/adError` cuando el fallo ocurre durante un ad. |

---

### A.5.2 — /adError · timeout de red al inicio

| Campo | Valor |
|---|---|
| **Sección** | Ads — Error handling |
| **Descripción** | Ad falla por mala red al inicio (timeout) → /adError |
| **Resultado Excel** | FAILED |
| **Comentario Excel** | /error event sent. No /adError appearing |
| **Test en repo** | 🚫 SIN TEST |
| **Conclusión** | Mismo root cause que A.5.1 |

---

### A.5.3 — /adError · ad redirect durante playback

| Campo | Valor |
|---|---|
| **Sección** | Ads — Error handling |
| **Descripción** | Ad falla por redirect durante la reproducción → /adError |
| **Resultado Excel** | FAILED |
| **Comentario Excel** | /error event sent. No /adError appearing |
| **Test en repo** | 🚫 SIN TEST |
| **Conclusión** | Mismo root cause que A.5.1 |

---

### A.5.4 — /adError · timeout de red durante playback

| Campo | Valor |
|---|---|
| **Sección** | Ads — Error handling |
| **Descripción** | Ad falla por mala red durante reproducción (timeout) → /adError |
| **Resultado Excel** | FAILED |
| **Comentario Excel** | /error event sent. No /adError appearing |
| **Test en repo** | 🚫 SIN TEST |
| **Conclusión** | Mismo root cause que A.5.1 |

---

## Resumen ejecutivo

| Categoría | IDs | Count |
|---|---|---|
| Limitación UI (no testeable) | 1.4, 7.2 | 2 |
| Tests existentes que FALLAN | 2.17 (a/b/c) | 1 caso / 3 tests |
| Bug conocido del player (BUG-6) | A.2.16, A.2.17, A.2.19 | 3 |
| Gap /adBufferUnderrun vs /bufferUnderrun | A.3.3, A.4.1 | 2 |
| Gap /adError vs /error | A.5.1, A.5.2, A.5.3, A.5.4 | 4 |
| Test FIXME (pendiente implementar) | A.3.1 | 1 |
| Cobertura parcial (valor no validado) | A.2.2, A.2.4 | 2 |
| Sin test + sin cobertura | A.2.13, A.2.23 | 2 |

### Bugs identificados en el player

- **BUG-6**: `api.ad.info` no expone `adResource`, `adTitle`, `adProvider` → cubre A.2.16, A.2.17, A.2.19
- **BUG-adEvent**: El tracker NPAW no distingue entre errores/buffers en contenido vs en ads → emite `/bufferUnderrun` y `/error` en lugar de `/adBufferUnderrun` y `/adError` → cubre A.3.3, A.4.1, A.5.1–A.5.4
- **BUG-userType**: `customer_extras.type/name` no se mapea a `user.type/name` en el beacon `/start` → cubre 2.17
