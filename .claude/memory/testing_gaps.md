---
name: Gaps de Testing — Cobertura Faltante
description: Features del player sin cobertura de tests y correcciones pendientes identificadas desde el código fuente
type: project
---

# Testing Gaps — Lightning Player QA

**Identificados el:** 2026-04-08 (análisis del código fuente del player v1.0.58)
**Estado:** Pendiente de implementación

Cada item tiene su estado. Actualizar este archivo cuando se implementen los tests.

---

## CORRECCIONES URGENTES — Falsos positivos actuales

### 1. Tests de DASH ABR son inválidos

**Problema:** El player no tiene dash.js. DASH usa playback nativo del browser.
Las propiedades `level`, `levels`, `bandwidth`, `bitrate`, `nextLevel` NO funcionan para DASH.

**Archivos afectados:**
- `tests/performance/qoe-metrics.spec.ts:43` — test "startup time < 3s (DASH VOD)"
- Cualquier test que use `Streams.dash.*` y verifique ABR

**Acción:** Agregar comentario explicativo aclarando que DASH solo testea playback nativo del browser.
No hay asserts de ABR en el test — el riesgo es que futuros tests asuman ABR para DASH.

**Estado:** ✅ Resuelto 2026-04-08 — Test renombrado a "DASH VOD — playback nativo" con comentario
que explica explícitamente la ausencia de dash.js y qué valida realmente el test.

---

### 2. Interceptor de plataforma usaba dominio hardcodeado

**Problema:** `platform-mock.ts` tenía `'**/develop.mdstrm.com/**'` hardcodeado en todas las
funciones (`setupPlatformMocks`, `mockContentConfig`, `mockPlayerConfig`, `mockContentError`).
Si los tests corrían con `PLAYER_ENV=prod`, el player (prod) hacía requests a `embed.mdstrm.com`,
el `page.route()` no matcheaba, y el player intentaba cargar `MockContentIds.vod = 'mock-vod-1'`
de la plataforma real → comportamiento no determinista (404 o fallback del player).

**Estado:** ✅ Resuelto 2026-04-08 — `setupPlatformMocks()` y todas las funciones de mock
ahora leen `getEnvironmentConfig().platformDomain` dinámicamente. El dominio está definido
en `config/environments.ts` por ambiente (dev/staging/prod).

**Pendiente:** Confirmar con el player team el dominio real de staging. Actualmente
asumido como `staging.mdstrm.com` — marcado con TODO en `environments.ts`.

---

### 3. `retries` en CI estaba invertido

**Problema en `playwright.config.ts`:**
```typescript
retries: IS_CI ? 0 : 1  // ← Al revés
```

En CI debería haber más retries (2), no menos. CI tiene más variabilidad (cold starts, VMs).
Con 0 retries en CI, un test flaky legítimamente bueno falla el pipeline.

**Estado:** ✅ Resuelto 2026-04-08 — Cambiado a `retries: IS_CI ? 2 : 1`

---

### 4. `ads.map` vs `adsMap` en el harness

**Problema:** El player acepta `ads: { map: 'url' }` en la config.
El Page Object usa `adsMap?: string` como campo de nivel raíz en `InitConfig`.
El harness (`harness/index.html`) debe remapear `adsMap → ads.map`.

**Acción:** Verificar en `harness/index.html` que el `__initPlayer(cfg)` hace el remapeo.
Si no lo hace, todos los tests de ads están pasando `adsMap` al player que lo ignora.

**Estado:** ⬜ Pendiente verificación

---

## COBERTURA FALTANTE — Features sin tests

### 5. SGAI — Google Server-Guided Ad Insertion

**Feature:** Nueva en v1.0.58. Detecta cue markers en HLS manifests para insertar ad breaks.
**Riesgo:** Bugs conocidos de timing y multi-instancia.
**Tests necesarios:**

```
tests/integration/sgai.spec.ts:
  - cue marker en HLS manifest dispara ad break
  - ad break SGAI completa y contenido resume
  - multi-player: SGAI no contamina segunda instancia
  - manifest sin cue markers: player funciona normalmente
```

**Prerrequisito:** HLS fixture con `#EXT-X-DATERANGE` markers en `fixtures/streams/`.

**Estado:** ⬜ Sin implementar

---

### 6. Multi-instancia

**Feature:** Múltiples players en la misma página.
**Riesgo:** Bug conocido de global `pLoader` registry contamina instancias.
**Tests necesarios:**

```
tests/integration/multi-instance.spec.ts:
  - dos players: eventos de A no disparan listeners de B
  - destroy() de A no afecta B
  - volume de A independiente de B
  - SGAI de A no contamina B (una vez implementado SGAI)
```

**Estado:** ⬜ Sin implementar

---

### 7. contentFirstPlay — para flujos con ads

**Evento:** `contentFirstPlay` se emite cuando el contenido (no el ad) inicia por primera vez.
**Relevancia:** Analytics crítico — distingue impresión de ad de impresión de contenido.
**Tests necesarios:**

```
- contentFirstPlay se emite exactamente una vez por load()
- contentFirstPlay se emite DESPUÉS de adsAllAdsCompleted (si hay pre-roll)
- contentFirstPlay NO se emite durante playback del ad
```

**Estado:** ⬜ Sin implementar

---

### 8. DVR: seekable, programdatetime, edge

**Feature:** En streams DVR, el rango seekable crece con el tiempo.
`programdatetime` emite la hora real del programa (EXT-X-PROGRAM-DATE-TIME en HLS).
**Tests necesarios:**

```
tests/e2e/live-playback.spec.ts (agregar):
  - seekable.end aumenta con el tiempo en live DVR
  - seek a posición en DVR actualiza currentTime correctamente
  - programdatetime event se emite con timestamp válido
```

**Prerrequisito:** Stream DVR real en `ContentIds` con suficiente historia.

**Estado:** ⬜ Sin implementar

---

### 9. Error types específicos

**Problema:** Los tests solo verifican "hay un error" (`getErrors().length > 0`).
El player define un enum completo de error types en `constants.cjs`.
**Tests necesarios:**

```
tests/e2e/error-handling.spec.ts (agregar):
  - error de red → type: 'NETWORK_ERROR', fatal: true
  - stream no soportado → type: 'MEDIA_ERROR'
  - DRM error → type: 'DRM_ERROR'
  - 404 del stream → player hace retry y emite error si falla
```

**Estado:** ⬜ Sin implementar

---

### 10. nextEpisode flow

**Feature:** El player emite `nextEpisodeIncoming` antes del final, `nextEpisodeConfirmed` al aceptar.
**Tests necesarios:**

```
tests/e2e/vod-playback.spec.ts (agregar):
  - nextEpisodeIncoming se emite N segundos antes del final
  - load() desde nextEpisodeConfirmed carga el episodio siguiente
```

**Prerrequisito:** ContentId de un episodio que tenga "siguiente episodio" configurado.

**Estado:** ⬜ Sin implementar

---

### 11. Analytics network beacons (Mediastream Tracker)

**Feature:** El player dispara requests a `track-dev.mdstrm.com` (dev) / `track.mdstrm.com` (prod).
Actualmente no verificamos que analytics funcione, solo que el player funcione.
**Tests necesarios:**

```
tests/integration/analytics-beacons.spec.ts:
  - play event genera beacon al tracker
  - beacon contiene contentId correcto
  - beacon no se dispara durante ad (para evitar inflar métricas de contenido)
```

**Nota:** Estos tests deben correr con `isolatedPlayer` + interceptor de tracker.

**Estado:** ⬜ Sin implementar

---

### 12. Contract validation de la platform API

**Problema:** Los mocks en `fixtures/platform-responses/` son JSONs estáticos.
Si `embed.mdstrm.com` cambia su schema, los mocks quedan desactualizados.
**Solución:** Validación de JSON Schema en global setup (opcional, activado con env var).

```
setup/global-setup.ts (agregar):
  - Si VALIDATE_PLATFORM_CONTRACT=true:
    - Fetch real del endpoint de la plataforma
    - Validar contra schema JSON en setup/schemas/content-response.schema.json
    - Fail rápido si el contrato cambió
```

**Estado:** ⬜ Sin implementar (gap de plataforma, no del player)

---

### Contract del player (API pública)

**Estado:** ✅ Implementado 2026-04-08
- `contracts/player-api.ts` — fuente de verdad: métodos, propiedades, eventos requeridos
- `tests/contract/player-api.spec.ts` — 8 tests que validan la superficie de API
- Corre como proyecto "contract" antes de CI completo
- Mensajes: "CONTRACT VIOLATION [player v1.0.58]: player.status — ..."

---

### 13. ABR: nextLevel vs level (nivel solicitado vs activo)

**Feature:** `player.level` = nivel HLS activo ahora. `player.nextLevel` = nivel que se está solicitando.
Los tests de ABR solo verifican `level`. Para tests de calidad manual, hay que verificar
que `nextLevel` se aplica y eventualmente `level` lo refleja.

**Estado:** ⬜ Sin tests específicos

---

### 14. `sourcechange` event en load()

**Feature:** Cuando `player.load()` cambia el contenido, se emite `sourcechange`.
Actualmente los tests de `load()` esperan `ready` pero no verifican `sourcechange`.

**Estado:** ⬜ Sin cubrir

---

## EVENTOS NO CUBIERTOS EN EL HARNESS

El harness `window.__qa.events` debería trackear todos estos (verificar que lo hace):

- `contentFirstPlay` ← No en el CLAUDE.md original
- `sourcechange` ← No verificado en tests
- `adsImpression` ← Solo beacon HTTP, no evento del player
- `adsSkippableStateChanged` ← No cubierto
- `audiotrackaddtrack` / `audiotrackremovetrack` ← Solo `audiotrackchange`
- `programdatetime` ← No cubierto
- `nextEpisodeIncoming` / `nextEpisodeConfirmed` ← No cubierto
- `castConnected` / `castDisconnected` ← No en scope pero documentar

---

## CORRECCIONES A CLAUDE.md PENDIENTES

1. DASH: "HLS (hls.js), MPEG-DASH (dash.js)" → "HLS (hls.js), MPEG-DASH (nativo browser, sin dash.js)"
2. Versión: 1.0.56 → 1.0.58
3. Agregar `ads: { map }` como forma correcta de config (no solo `adsMap`)
4. Agregar eventos faltantes: `contentFirstPlay`, `sourcechange`, `adsImpression`, etc.
5. Agregar propiedades faltantes: `nextLevel`, `seekable`, `edge`, `videoWidth/Height`
6. Agregar sección de SGAI con sus bugs conocidos

**Estado:** ⬜ Pendiente de actualización
