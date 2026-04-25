---
name: Triage — a11y Player de Audio (view type invalido)
description: Test de accesibilidad falla porque view:'audio' no existe como view type en el player
type: project
---

# Triage — Accessibility Player de Audio — 2026-04-25

## Test analizado

`tests/a11y/accessibility.spec.ts` > `Accessibility — Player de Audio` > `no hay violaciones WCAG en player de audio`

## Clasificacion

**DEFECTO DE TEST** — el player se comporta correctamente segun su arquitectura.

## Hallazgo principal

`view: 'audio'` no es un view type valido en el Lightning Player. Los view types registrados en
`src/view/index.jsx` son: `radio`, `radioSA`, `podcast`, `podcast2`, `lightning`/`video`, `none`, `reels`, `compact`.

Cuando `view.type = 'audio'`, el componente View retorna `<React.Fragment/>`.
Sin UI, `<Controls>` nunca se monta, `_controlsReady` nunca se emite,
y `loadMSPlayer` cuelga indefinidamente.

## Fix intentado (insuficiente)

El fix previo agregó `mockAudioPlayerConfig(page)` al test body. Esto es correcto en mecanismo
(LIFO sobre setupPlatformMocks) pero no en valor: `audio.json` retorna `view.type: 'audio'`
que sigue siendo invalido.

## Patron sistémico

El mismo fallo afecta a `tests/e2e/view-types.spec.ts` (3 tests de view audio)
y `tests/visual/player-ui.spec.ts`. Ver patron en patterns/audio-view-type-invalid.md.

## Correcciones necesarias

1. `fixtures/platform-responses/player/audio.json` → cambiar `view.type` de `'audio'` a `'radio'`
2. `tests/a11y/accessibility.spec.ts:97` → cambiar `view: 'audio'` a `view: 'radio'`
3. `tests/e2e/view-types.spec.ts` → cambiar `view: 'audio'` a `view: 'radio'` en todos los tests de audio
4. `tests/visual/player-ui.spec.ts:93` → idem
5. `tests/e2e/debug-view-audio.spec.ts:23` → idem

## Documento de triage

`triage/test-corrections/2026-04-25_a11y-audio-view-invalid-type.json`
