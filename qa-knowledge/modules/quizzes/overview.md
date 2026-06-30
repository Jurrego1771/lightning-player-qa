# Quizzes — Overview

## Qué hace

El módulo **Quizzes** muestra cuestionarios interactivos en overlay sobre el reproductor de video. Permite que el espectador responda preguntas de opción única o múltiple mientras consume contenido, con feedback inmediato (correcto/incorrecto) y reporte de la respuesta a analytics (StreamMetrics).

Soporta dos orígenes de quizzes, con comportamiento diferenciado:

1. **VOD (`type === 'media' | 'episode'`)** — los quizzes vienen embebidos en `metadata.quizzes`. Se activan por tiempo: cuando `currentTime` entra en la ventana `[trigger_time, trigger_time + 2s]`. Al activarse, **pausan la reproducción** (caso "pop quiz" / interactive video). Cada quiz se marca como completado y no se vuelve a mostrar en la misma sesión.

2. **LIVE (`type === 'live'`)** — los quizzes se disparan en tiempo real vía **Firebase Firestore** (colección `live_quizzes`, condición `status == 'active'`). Un trigger reciente (≤ 15s) detona la carga del quiz completo desde el API REST (`/api/live-stream/{liveId}/quizzes/{quizId}`) con reintentos. Los quizzes live **NO pausan** la reproducción (el efecto de pausa solo aplica a VOD).

Si un quiz se activa mientras otro está activo, el nuevo se **encola** (FIFO) y se procesa al completar el actual.

## Archivos clave

| Archivo | Rol |
|---------|-----|
| `src/view/video/atoms/quiz.js` | Estado central (Jotai): atoms de quiz activo, sesión, cola, mapa live, reducer `quizActionsAtom`, efectos de activación (VOD por tiempo) y cleanup. Constantes de configuración. |
| `src/view/video/hooks/useQuiz.js` | Hook de orquestación de UI: derivación de pregunta actual, selección, validación de respuesta, submit, progreso, pausa VOD, emisión de `quizAnswered`, resume de playback al cerrar/completar. |
| `src/view/video/hooks/useLiveQuiz.js` | Suscripción Firestore para quizzes en vivo; filtro de frescura (15s); dispatch de `FIREBASE_QUIZ_TRIGGER`; reset al salir de live. |
| `src/view/video/components/quiz/quiz.jsx` | Componente raíz del overlay (lazy-loaded). `role="dialog"`, `aria-modal`. Ensambla header/options/footer. |
| `src/view/video/components/quiz/index.jsx` | Wrapper `React.lazy` + `Suspense` para code-splitting del overlay. |
| `src/view/video/components/quiz/components/QuizHeader.jsx` | Título del quiz, texto de la pregunta, botón de cierre. |
| `src/view/video/components/quiz/components/QuizOptions.jsx` | Renderiza opciones como `radio` (single) o `checkbox` (multiple); estados selected/correct/incorrect; navegación por teclado. |
| `src/view/video/components/quiz/components/QuizFooter.jsx` | Botón submit/continue/finish, barra de progreso (`role="progressbar"`), feedback `aria-live="polite"`. |
| `src/view/i18n/{en,es,pt}/video.json` | Claves de traducción bajo `quiz.*` (título, botones, feedback, etiquetas a11y). Introducidas/tocadas en PR #705 (i18n video-only). |
| `src/analytics/streammetrics/tracker.js` | Consume el evento interno `quizAnswered` y emite el ping `quiz_answered` con POST inmediato. |

## Flujo de datos

```
                        ┌─────────────── VOD ───────────────┐
metadata.quizzes ──▶ rawQuizzesAtom ──▶ quizzesAtom
                                              │
                        currentTimeSecondsAtom │  quizActivationEffect
                                              ▼  (trigger_time .. +2s, no completado)
                                     ACTIVATE_QUIZ ──▶ activeQuizInnerAtom
                                                            │
                        ┌─────────────── LIVE ──────────────┤
Firestore live_quizzes  │                                   │
 (status==active)       │ useLiveQuiz → isQuizRecent(15s)   │
        │               │      │                            │
        ▼               │      ▼                            │
 FIREBASE_QUIZ_TRIGGER ─┘  fetchQuizWithRetry (3x, backoff) ─┘
                              GET /api/live-stream/{id}/quizzes/{qid}

activeQuizInnerAtom ──▶ activeQuizAtom ──▶ useQuiz ──▶ Quiz overlay (dialog)
                                              │
   VOD: controls.pause() al activar          │ selectOption → quizSession.selectedOption
                                              │ submitAnswer:
                                              │   1ª vez: emite quizAnswered, calcula result (compareQuizAnswers)
                                              │   2ª vez: avanza pregunta o COMPLETE_QUIZ
                                              ▼
                  COMPLETE_QUIZ ──▶ activeQuiz=null ──▶ processNextQuizFromQueue
                                 ──▶ (VOD) completedQuizzes.add(id)
                                 ──▶ resumePlayback() → api.play()

quizAnswered (internalEmitter) ──▶ streammetrics ──▶ ping 'quiz_answered' + POST inmediato
```

## API pública

El módulo **no expone métodos públicos** en `api.*`. Su única superficie pública es un evento:

| Evento | Constante | Cuándo | Canal |
|--------|-----------|--------|-------|
| `quizAnswered` | `Events._quizAnswered` | Al enviar (submit) la respuesta de una pregunta, antes de calcular el resultado | `internalEmitter` (interno; consumido por StreamMetrics). No se reenvía vía `externalEmitter`. |

Payload de `quizAnswered` (construido en `buildAnalyticsData`):

```
{
  quiz_id, quiz_name, question_id, question_text,
  answer_index,           // number | "i||j" (multiple, ordenado)
  answer_text,            // texto de opción | "a||b" (multiple)
  correct_answer_index    // number | "i||j"
}
```

> Nota QA: este evento es **interno** — los tests deben verificarlo a través del beacon `quiz_answered` de StreamMetrics, no esperando un evento público del player.

## Interacciones con otros sistemas

- **Controls / Playback-core**: `controls.pause()` al activar quiz VOD; `api.play()` al cerrar/completar. Acoplamiento alto: si la API de controls cambia, la pausa/resume del quiz se rompe silenciosamente (los `.catch(() => {})` ocultan errores).
- **Metadata**: VOD lee `metadata.quizzes` vía `contextValueFamily('metadata.quizzes')`.
- **Firestore (metadata/firestore)**: live usa `useFirestore` sobre la colección `live_quizzes`.
- **StreamMetrics (analytics)**: único consumidor del evento `quizAnswered`.
- **i18n (PR #705)**: todos los textos visibles y etiquetas ARIA dependen de las claves `quiz.*`; el overlay no se renderiza hasta que `useTranslation('video').ready === true`.
- **Context atoms**: `type`, `id`, `currentTime` gobiernan activación y reset.
- **controlsHeight atom**: posiciona el overlay por encima de la barra de controles.
