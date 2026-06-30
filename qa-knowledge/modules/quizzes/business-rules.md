# Quizzes — Business Rules

Reglas derivadas del código fuente del player (`src/view/video/atoms/quiz.js`,
`hooks/useQuiz.js`, `hooks/useLiveQuiz.js`, componentes `quiz/*`) y de prácticas de
la industria de interactive video.

## Reglas de activación

**BR-QUIZ-001** — Activación VOD por ventana temporal
Un quiz VOD se activa cuando `currentTime` cae dentro de `[trigger_time, trigger_time + 2s]`
(`QUIZ_ACTIVATION_WINDOW = 2`) y el quiz no ha sido completado en la sesión. La ventana es
fija; un trigger no se recupera si se salta.

**BR-QUIZ-002** — Origen de quizzes por tipo de contenido
Para `type` `media`/`episode`, los quizzes provienen de `metadata.quizzes`. Para `type`
`live`, provienen de la colección Firestore `live_quizzes` (cargados por API REST tras el
trigger). Para cualquier otro tipo, no hay quizzes.

**BR-QUIZ-003** — Frescura de triggers en vivo
Un trigger live solo es válido si su `timestamp` tiene una antigüedad de **≤ 15 segundos**
respecto al momento actual y no es futuro (`age >= 0`). Triggers más viejos se descartan.
Un trigger sin timestamp NO se descarta (se asume válido).

**BR-QUIZ-004** — Carga del quiz live con reintentos
Tras el trigger, si el quiz no está cacheado, se obtiene de
`/api/live-stream/{liveId}/quizzes/{quizId}` con hasta **3 intentos** y backoff lineal
(`2000ms × intento`). Tras agotar reintentos, el quiz no se muestra y no se propaga error.

## Reglas de reproducción

**BR-QUIZ-005** — Pausa solo en VOD
Al activarse un quiz en VOD se invoca `controls.pause()`. En live **no** se pausa la
reproducción (no se puede pausar el directo sin perder el live edge).

**BR-QUIZ-006** — Reanudación al cerrar o completar
Al completar la última pregunta (`Finish`) o al cerrar manualmente el quiz (botón X),
se invoca `api.play()` para reanudar la reproducción.

## Reglas de respuesta y evaluación

**BR-QUIZ-007** — Tipo de pregunta inferido
Una pregunta es de **opción múltiple** si tiene más de una opción con `isCorrect=true`;
en ese caso se renderiza con checkboxes. En caso contrario es de **opción única** (radio).

**BR-QUIZ-008** — Submit de dos fases
El primer Submit calcula el resultado (emite `quizAnswered` y muestra feedback) sin
avanzar. El segundo Submit avanza a la siguiente pregunta (`Continue`) o completa el quiz
(`Finish` en la última pregunta).

**BR-QUIZ-009** — Corrección exacta
Una respuesta es correcta solo si el conjunto de índices seleccionados coincide
**exactamente** (orden-insensible, sin duplicados, solo enteros ≥ 0) con el conjunto de
índices correctos. En opción múltiple se exigen todas las correctas y ninguna incorrecta.

**BR-QUIZ-010** — Submit requiere selección
No se puede enviar una respuesta sin al menos una opción seleccionada
(`hasSelectedOption`). El botón Submit permanece deshabilitado.

**BR-QUIZ-011** — Una sola medición por pregunta
`quizAnswered` se emite **una sola vez** por pregunta (en la fase de cálculo de
resultado). Guards (`isSubmittingRef` + `isSubmitting`) evitan envíos duplicados.

## Reglas de ciclo de vida y persistencia

**BR-QUIZ-012** — No repetición en VOD
Un quiz VOD completado se registra en `completedQuizzes` y no se reactiva durante la
sesión, incluso si el usuario hace seek de vuelta sobre su `trigger_time`.

**BR-QUIZ-013** — Live no persiste completados
En live, completar un quiz no lo marca como completado; depende del backend cambiar el
`status` del documento Firestore para que no vuelva a dispararse.

**BR-QUIZ-014** — Encolado FIFO con dedupe
Si llega un nuevo quiz mientras hay uno activo, se encola (FIFO) sin duplicar por `_id`.
Al completar/cerrar el activo, se procesa el siguiente de la cola.

**BR-QUIZ-015** — Reset total al cambiar de contenido
Un cambio de contenido (cambio de `id` / desmontaje) dispara `RESET_ALL`, limpiando quiz
activo, sesión, completados, cola, mapa live y contador de reintentos.

## Reglas de analytics

**BR-QUIZ-016** — Reporte interno hacia StreamMetrics
El evento `quizAnswered` es interno (`internalEmitter`) y su único consumidor es
StreamMetrics, que emite el beacon `quiz_answered` con **POST inmediato** (no batch). El
payload incluye `quiz_id`, `quiz_name`, `question_id`, `question_text`, `answer_index`,
`answer_text` y `correct_answer_index`.

**BR-QUIZ-017** — Formato de respuestas múltiples
En opción múltiple, `answer_index` y `answer_text` se serializan unidos por `||` en orden
ascendente de índice; `correct_answer_index` igual cuando hay más de una correcta.

## Reglas de la industria aplicables

**BR-QUIZ-IND-001** — Pop-quiz que pausa es estándar de interactive video
La práctica establecida (Kaltura, Vimeo) es pausar el video y exigir respuesta antes de
continuar. El modelo VOD del player es consistente; QA debe tratar la pausa+respuesta como
el contrato esperado del usuario.

**BR-QUIZ-IND-002** — Tracking granular de quiz (estilo xAPI)
Los estándares de tracking (xAPI/SCORM hacia un LRS) registran qué opción eligió el usuario
y cuál era la correcta. El payload de `quizAnswered` cumple esa granularidad y debe
mantenerla (opción elegida + opción correcta) para integraciones de analytics/learning.

**BR-QUIZ-IND-003** — Diálogos modales deben atrapar foco, cerrar con Esc y restaurar foco
Según WAI-ARIA Authoring Practices, un `role="dialog"` `aria-modal="true"` debe implementar
focus trap, cierre con Escape y retorno de foco al disparador. El overlay actual no lo hace;
es una desviación documentada (QUIZ-DEF-002) que QA debe verificar como known gap, no como
regresión nueva.

**BR-QUIZ-IND-004** — Latencia de tiempo real condiciona la puntualidad del quiz live
La industria asume que los backends de tiempo real (Firestore ~600-1500ms RTT) introducen
retraso frente a un websocket directo (~40ms). El quiz live puede aparecer con varios
segundos de retraso; el filtro de frescura de 15s acota cuán tarde puede aparecer.
