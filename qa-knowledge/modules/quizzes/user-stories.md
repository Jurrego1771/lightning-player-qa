# Quizzes — User Stories

Historias de usuario con metadata estructurada. Personas: **Viewer** (espectador),
**Integrator** (cliente que integra el player), **Operator** (productor / equipo de
emisión en vivo).

```yaml
version: "1.0"
module: quizzes
last_updated: "2026-06-10"

user_stories:
  - id: US-QUIZ-001
    persona: Viewer
    narrative:
      as: "espectador de un video VOD interactivo"
      want: "que el video se pause y me muestre una pregunta en el momento previsto"
      so_that: "pueda reflexionar y responder sin perderme contenido"
    business_value: HIGH
    risk_area:
      - "activación por tiempo (ventana de 2s)"
      - "pausa de reproducción"
    related_features:
      - playback-core
      - controls-api
      - metadata
    acceptance:
      - QUIZ-AC-001
      - QUIZ-AC-005
    notes: "Happy path VOD. Si un seek cruza la ventana de 2s el quiz se pierde (QUIZ-DEF-004)."

  - id: US-QUIZ-002
    persona: Viewer
    narrative:
      as: "espectador respondiendo un quiz"
      want: "recibir feedback inmediato de si acerté o no y ver la respuesta correcta"
      so_that: "aprenda del resultado antes de continuar"
    business_value: HIGH
    risk_area:
      - "evaluación de respuesta"
      - "feedback accesible (aria-live)"
    related_features:
      - i18n
    acceptance:
      - QUIZ-AC-002
      - QUIZ-AC-003
    notes: "Feedback en role=status aria-live=polite. Requiere doble Submit (calcular, luego avanzar)."

  - id: US-QUIZ-003
    persona: Viewer
    narrative:
      as: "espectador en una pregunta de opción múltiple"
      want: "marcar varias respuestas y que se evalúen todas juntas"
      so_that: "pueda responder preguntas con más de una opción correcta"
    business_value: MEDIUM
    risk_area:
      - "checkbox vs radio"
      - "comparación exacta de conjuntos"
    related_features: []
    acceptance:
      - QUIZ-AC-007
    notes: "isMultipleChoice se infiere de >1 opción correcta; no hay flag explícito."

  - id: US-QUIZ-004
    persona: Viewer
    narrative:
      as: "espectador que no quiere responder ahora"
      want: "cerrar el quiz y volver a ver el video"
      so_that: "no se interrumpa mi experiencia si no me interesa el cuestionario"
    business_value: MEDIUM
    risk_area:
      - "resume de reproducción"
      - "cierre del modal"
    related_features:
      - controls-api
    acceptance:
      - QUIZ-AC-008
    notes: "Cerrar marca completado en VOD y reanuda con api.play(). Sin Escape ni focus trap (QUIZ-DEF-002)."

  - id: US-QUIZ-005
    persona: Viewer
    narrative:
      as: "espectador de un evento en vivo"
      want: "que aparezca un quiz en tiempo real durante la transmisión sin detener el directo"
      so_that: "pueda participar en encuestas o trivias en el momento exacto del programa"
    business_value: HIGH
    risk_area:
      - "trigger Firestore en tiempo real"
      - "latencia / frescura 15s"
      - "no pausar el live"
    related_features:
      - firebase-firestore
      - live-stream-quiz-api
    acceptance:
      - QUIZ-AC-009
      - QUIZ-AC-010
    notes: "Live no pausa. La latencia de Firestore (~600-1500ms) afecta la puntualidad (QUIZ-RISK-003)."

  - id: US-QUIZ-006
    persona: Viewer
    narrative:
      as: "espectador usando lector de pantalla / teclado"
      want: "que el quiz se anuncie como diálogo y sea navegable y localizado a mi idioma"
      so_that: "pueda responder con tecnología asistiva en mi lengua"
    business_value: MEDIUM
    risk_area:
      - "ARIA dialog / progressbar / status"
      - "i18n es/en/pt"
      - "focus trap ausente"
    related_features:
      - i18n
    acceptance:
      - QUIZ-AC-014
      - QUIZ-AC-015
    notes: "PR #705 (i18n video-only) gobierna las claves quiz.*. Focus trap y Escape pendientes (QUIZ-DEF-002)."

  - id: US-QUIZ-007
    persona: Operator
    narrative:
      as: "productor de un evento en vivo"
      want: "lanzar un quiz desde el backend y confiar en que llega a tiempo y solo una vez"
      so_that: "la interacción coincida con el momento del programa sin repeticiones"
    business_value: HIGH
    risk_area:
      - "reintentos de carga"
      - "frescura / dedupe en cola"
      - "no persistencia de completados en live"
    related_features:
      - live-stream-quiz-api
      - firebase-firestore
    acceptance:
      - QUIZ-AC-011
      - QUIZ-AC-012
    notes: "El backend debe cambiar status del doc Firestore para evitar reaparición (QUIZ-DEF-005)."

  - id: US-QUIZ-008
    persona: Integrator
    narrative:
      as: "integrador del player con un sistema de analytics/LMS"
      want: "recibir un evento de respuesta con qué eligió el usuario y qué era correcto"
      so_that: "pueda medir engagement y resultados de quizzes en mi plataforma"
    business_value: HIGH
    risk_area:
      - "evento interno quizAnswered → beacon StreamMetrics"
      - "completitud del payload"
    related_features:
      - analytics-streammetrics
      - events
    acceptance:
      - QUIZ-AC-002
    notes: >
      quizAnswered es interno; observable vía beacon quiz_answered de StreamMetrics
      (POST inmediato). Payload alineado con granularidad xAPI (opción elegida + correcta).

  - id: US-QUIZ-009
    persona: Integrator
    narrative:
      as: "integrador que cambia de contenido en el player programáticamente"
      want: "que el estado de quizzes se limpie por completo al cambiar de video"
      so_that: "los quizzes de un contenido no contaminen el siguiente"
    business_value: MEDIUM
    risk_area:
      - "reset on sourcechange"
    related_features:
      - state
      - playback-core
    acceptance:
      - QUIZ-AC-013
    notes: "quizCleanupEffect dispara RESET_ALL al cambiar id / desmontar."
```
