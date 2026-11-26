# Pulsating star — one spherical harmonic

Files: `plugins/pulsStarPlugin.js` (slide element), `plugins/sphericalHarmonics.js` (maths + three.js). Needs three.js.

```html
<div class="star" data-l="3" data-m="2" data-label></div>
```

| Attribute | Default | Meaning |
|---|---|---|
| `data-l`, `data-m` | `2`, `1` | Degree and azimuthal order (integers, abs(m) ≤ l). |
| `data-size` | `500` | Canvas width = height in slide pixels. |
| `data-amp` | `0.1` | Largest fractional change of the radius. |
| `data-rate` | `0.5` | Pulsations per second. |
| `data-spin` | `0.3` | Rotation, radians per second. |
| `data-colors` | `#1a4dff,#ffffff,#ff1a1a` | Colors for [inwards, nodes, outwards]. |
| `data-color-gamma` | `0.5` | < 1: colors saturate faster (thinner white nodal lines). |
| `data-color-mode` | `displacement` | `displacement` (colors follow the motion) or `pattern` (fixed pattern). |
| `data-segments` | `auto` | Mesh resolution (longitude segments). |
| `data-grid`, `data-grid-spacing`, `data-grid-color`, `data-grid-width`, `data-grid-opacity` | off, `30`, `#000`, `1.5`, `0.6` | Latitude/longitude lines. |

## Caption

| Attribute | Meaning |
|---|---|
| `data-label` | Automatic caption *ℓ* = 3, *m* = 2. |
| `data-label="text"` | Your text: `{l}` `{m}` are replaced, `\ell` etc. become symbols, `*x*` is italic. |
| `data-label-color` | Text color. |
| `data-label-offset` | Distance in px from the canvas bottom (negative = below the canvas). |

## From JavaScript

`createStar(container, options)` → `{ start, stop, set, dispose }`. Options: `l, m, segments, pulseRate,
pulseAmplitude, spinRate, colors, colorGamma, colorMode, grid, gridSpacing, gridColor, gridWidth, gridOpacity`.
