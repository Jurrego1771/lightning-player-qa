# Thumbnails VOD cortados — evidencia (sprite/VTT mismatch)

**Causa raíz:** al hacer *replace* de la media no se regeneran el sprite ni el VTT.
La media quedó con un sprite de **baja resolución** (JPG real **1000×580**) mientras el
VTT sigue declarando una rejilla de **2160×1220** (tiles de 216×122, grid 10×10).

El player recorta las coordenadas del VTT directamente sobre el JPG real:
- **Producción (`master`)** — render sin escalado → el recorte cae fuera de la imagen →
  miniaturas **cortadas / en negro**.
- **Develop (`#707`, commit `fdaec73c`)** — escala el recorte a la imagen real → ya no se
  corta, pero la miniatura sale **borrosa/distorsionada** (cada tile real ~100×58 estirado a 216×122).

El fix del player evita el corte pero **no recupera la calidad**. La solución de fondo es
**regenerar sprite + VTT al hacer replace de la media** (en resolución correcta).

## Capturas

| Archivo | Qué muestra |
|---|---|
| `01-sprite-correcto-2160x1220-nitido.png` | Sprite correcto (coincide con el VTT) → miniatura nítida, sin corte. |
| `02-viejo-prod-vs-nuevo-develop.png` | Mismo sprite baja-res, render **VIEJO (prod)** vs **NUEVO (#707/develop)**. Viejo: mosaico desalineado / negro (tile `x=1944` = 100% negro). Nuevo: cuadro completo. |
| `03-con-fix-pero-borroso-a.png` | Con el fix (develop) + sprite baja-res → sin corte pero **borroso**. |
| `04-con-fix-pero-borroso-b.png` | Ídem, otra posición del timeline. |
| `05-swap-sprite-bajares-en-player.png` | Reemplazo del sprite baja-res en el player real (hover en timeline). |

## Datos técnicos

- VTT declara: 100 cues, tiles 216×122, grid 10×10 → sprite esperado **2160×1220**.
- JPG real (media en baja resolución): **1000×580** → factor de escala ≈ **0.46×0.48**.
- % de tile fuera de la imagen con render viejo (prod): `x=0` desalineado, `x=864` ~37% cortado, `x=1944,y=1098` (última) **100% negro**.

## Recomendaciones

1. **Backend:** regenerar sprite + VTT al hacer *replace* de la media (resolución acorde al VTT).
2. **Player:** mergear `#707` (develop → master) para que prod al menos no corte la miniatura mientras se corrige el origen.
