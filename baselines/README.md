# Baselines — Visual Regression

Las imágenes de referencia se generan con el agente visual-regression (A9).

## Primera ejecución (capturar baselines)
```
/pipeline [ref] --capture-baselines
```
O directamente:
```
npx ts-node skills/capture_state.ts --state playing --output baselines/player_playing.png
```

## Estados requeridos
- player_idle.png
- player_buffering.png
- player_playing.png
- player_controls.png
- player_fullscreen.png
- player_error.png
- player_ad_break.png

## Actualizar baselines tras cambio UI intencional
Correr A9 con --update-baselines después de aprobar el cambio visual.
