---
type: test-brief
feature: next-episode
status: active
---

# Test Briefs — Next Episode

## Brief 1 — Headless happy path

```yaml
feature: next-episode
scope: headless-none-view
goal: validar que playNext provoca la carga del siguiente contenido

preconditions:
  - player inicializado en view none
  - siguiente episodio disponible vía metadata.next o nextEpisodeId

input_expected:
  - contenido actual mock-vod-1
  - siguiente contenido mock-episode-1
  - nextEpisodeTime corto

output_expected:
  - nextEpisodeIncoming emitido
  - playNext devuelve success true
  - sourcechange emitido
  - metadataloaded del siguiente contenido

assertion_rationale:
  - playNext solo garantiza dispatch del evento
  - sourcechange más metadataloaded representan transición real mejor que metadata inmediata

observability:
  primary:
    - nextEpisodeIncoming
    - sourcechange
    - metadataloaded
  secondary:
    - ready
  unreliable:
    - player.metadata inmediata

false_positive_risks:
  - leer metadata demasiado pronto
  - confundir dispatch con cambio final de contenido

test_type: smoke
determinism_level: high
```
