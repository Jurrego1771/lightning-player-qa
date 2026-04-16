---
type: edge-cases
feature: next-episode
status: active
---

# Edge Cases — Next Episode

- `playNext()` devuelve `{ success: true }` pero no necesariamente completó la transición.
- `keepWatching()` devuelve `{ success: true }` aunque la vista actual no tenga handler útil para la lógica.
- `nextEpisodeOverride` puede bloquear el autoload si no hay confirmación.
- Si no existe `effectiveNextEpisode`, la feature no debe disparar carga.
- En `video`, el overlay puede no aparecer si el contenido entra demasiado tarde al umbral o no hay tiempo suficiente para animación.
- `player.metadata` puede quedarse con datos del contenido anterior inmediatamente después de un cambio.
- Las pruebas headless y las visuales no deben compartir la misma señal principal.
