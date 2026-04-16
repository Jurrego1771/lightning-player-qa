---
type: business-rules
feature: next-episode
status: active
---

# Business Rules — Next Episode

## Reglas principales

- `nextEpisodeIncoming` se dispara cuando `timeRemaining <= nextEpisodeTime + 5`.
- En `view: 'video'`, el overlay visible usa el umbral `timeRemaining <= nextEpisodeTime`.
- `keepWatching()` evita autoload al terminar el contenido en el flujo headless.
- `playNext()` intenta cargar inmediatamente el siguiente contenido.
- `updateNextEpisode()` confirma u overridea el siguiente contenido.

## Reglas de visibilidad

- En `video`, la UI no debe mostrarse para `live`, `audio` o `dvr`.
- Si el usuario eligió créditos, la UI deja de mostrarse.
- Si `nextEpisodeOverride` exige confirmación y aún no hay confirmación, la UI no debe autoload.

## Reglas de override

- Si `loadConfig()` recibe `nextEpisodeId`, se marca `nextEpisodeOverride = true`.
- Ese override cambia el flujo: ya no basta con `metadata.next`; puede requerir confirmación explícita.

## Invariantes

- Un despacho exitoso de `keepWatching()` o `playNext()` no garantiza por sí solo que el cambio de contenido ya ocurrió.
- El comportamiento válido depende de la vista activa.

## Casos donde no aplica

- contenido live
- audio-only
- DVR
