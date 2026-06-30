# Reactions — User Stories

> Historias de usuario con metadata estructurada para el módulo `reactions`.
> Personas: **Viewer** (espectador), **Integrator** (cliente que integra el player),
> **Operator** (broadcaster/equipo de plataforma del live).

---

## US-REACT-001 — Reaccionar en vivo

- **persona:** Viewer
- **as:** espectador de un live stream
- **want:** enviar una reacción emoji que flote sobre el video
- **so_that:** expresar cómo me siento en el momento sin escribir en el chat
- **business_value:** HIGH
- **risk_area:** [emisión, ui-overlay, real-time]
- **related_features:** [analytics-reactions, events, ui-video]
- **acceptance:** [REACT-AC-001, REACT-AC-002]
- **notes:** Solo disponible en live con la feature configurada. Patrón "timed reactions" estilo YouTube Live.

---

## US-REACT-002 — Ver las reacciones de la audiencia

- **persona:** Viewer
- **as:** espectador de un live stream
- **want:** ver las reacciones que envían otros espectadores flotando sobre el video
- **so_that:** sentir la energía colectiva de la audiencia en tiempo real
- **business_value:** HIGH
- **risk_area:** [real-time, dedup, performance, memoria]
- **related_features:** [metadata, analytics-reactions]
- **acceptance:** [REACT-AC-006]
- **notes:** Máx 5 simultáneas, efímeras (3s), deduplicadas (local↔remoto). Backend Firestore (live_reactions).

---

## US-REACT-003 — No ser interrumpido por reacciones durante anuncios

- **persona:** Viewer
- **as:** espectador durante un ad break o buffering
- **want:** que las reacciones se suspendan y no obstruyan ni distraigan
- **so_that:** la experiencia de anuncio/carga quede limpia
- **business_value:** MEDIUM
- **risk_area:** [ads-gating, estado]
- **related_features:** [ads-manager, events]
- **acceptance:** [REACT-AC-003]
- **notes:** reactionsDisabled('ads'/'buffering') oculta el FAB y cierra el selector.

---

## US-REACT-004 — Operar reacciones con teclado / control remoto

- **persona:** Viewer
- **as:** usuario que navega por teclado o D-pad de Smart TV
- **want:** abrir el selector, navegar entre reacciones y elegir una sin mouse/touch
- **so_that:** la feature sea accesible y operable en TV
- **business_value:** MEDIUM
- **risk_area:** [accesibilidad, navegación-teclado, ui-tv]
- **related_features:** [ui-tv, controls-api]
- **acceptance:** [REACT-AC-008]
- **notes:** role=menu/menuitem, Arrow H/V + Tab + Enter/Espacio + Escape, foco circular.

---

## US-REACT-005 — Experiencia accesible con movimiento reducido

- **persona:** Viewer
- **as:** usuario con sensibilidad vestibular que activó prefers-reduced-motion
- **want:** que las reacciones no realicen animaciones de movimiento agresivas
- **so_that:** ver el live sin malestar
- **business_value:** MEDIUM
- **risk_area:** [accesibilidad, animación]
- **related_features:** [ui-video]
- **acceptance:** [REACT-AC-002]
- **notes:** GAP CONOCIDO (REACT-DEF-002): hoy la animación ignora prefers-reduced-motion. Historia objetivo.

---

## US-REACT-006 — Emitir reacciones programáticamente

- **persona:** Integrator
- **as:** integrador del Lightning Player en mi app
- **want:** llamar player.emitReaction(code) y leer player.getReactions() desde mi UI
- **so_that:** construir mi propia interfaz de reacciones o telemetría
- **business_value:** MEDIUM
- **risk_area:** [api-publica, validación]
- **related_features:** [controls-api, analytics-reactions]
- **acceptance:** [REACT-AC-002, REACT-AC-005]
- **notes:** API nunca lanza; devuelve { success, error }. Códigos fuera de la allowlist → VALIDATION_FAILED.

---

## US-REACT-007 — Escuchar el evento reactionEmitted

- **persona:** Integrator
- **as:** integrador que necesita reaccionar a la actividad del usuario
- **want:** suscribirme al evento público reactionEmitted
- **so_that:** registrar engagement o disparar lógica propia
- **business_value:** MEDIUM
- **risk_area:** [eventos, api-publica]
- **related_features:** [events, analytics-reactions]
- **acceptance:** [REACT-AC-002]
- **notes:** Payload { reaction_code, player_id, playback_id, timestamp }. Único evento de reactions en constants.cjs.

---

## US-REACT-008 — Protección contra spam y abuso

- **persona:** Operator
- **as:** operador del live stream
- **want:** que el cliente limite la frecuencia de reacciones y rechace códigos inválidos/maliciosos
- **so_that:** proteger el backend real-time y evitar contenido inyectado
- **business_value:** HIGH
- **risk_area:** [rate-limit, seguridad, fiabilidad]
- **related_features:** [analytics-reactions, firebase-firestore]
- **acceptance:** [REACT-AC-004, REACT-AC-005, REACT-AC-009]
- **notes:** Debounce 250ms + 10/min + allowlist + circuit breaker. Errores de usuario no penalizan fiabilidad.

---

## US-REACT-009 — Configurar el set de reacciones del live

- **persona:** Operator
- **as:** operador que prepara un live
- **want:** definir desde plataforma qué reacciones (icon/animation) están disponibles
- **so_that:** adaptar el set de emojis al contenido/marca
- **business_value:** MEDIUM
- **risk_area:** [configuración, platform-config, sincronización]
- **related_features:** [platform-config, analytics-reactions]
- **acceptance:** [REACT-AC-001]
- **notes:** context.reactions = { code: { icon, animation } }. Si null, feature inactiva (degradación silenciosa). Validación contra intersección sistema↔live.

---

## US-REACT-010 — Resiliencia ante fallos del backend

- **persona:** Viewer
- **as:** espectador en una red inestable
- **want:** que el reproductor siga funcionando aunque el servicio de reacciones falle
- **so_that:** no perder el live por un fallo de una feature secundaria
- **business_value:** HIGH
- **risk_area:** [fiabilidad, degradación, real-time]
- **related_features:** [analytics-reactions, firebase-firestore]
- **acceptance:** [REACT-AC-009]
- **notes:** Circuit breaker + backoff; fallo total de transporte degrada en silencio sin crashear la reproducción.
