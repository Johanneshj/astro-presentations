# Pulsating star — one spherical harmonic

Files: `plugins/pulsStarPlugin.js` (slide element), `plugins/sphericalHarmonics.js` (maths + three.js). Needs three.js.

```html
<div class="star" data-l="3" data-m="2" data-label></div>
```

| Attribute | Default | Meaning |
|---|---|---|
| `data-l`, `data-m` | `2`, `1` | Degree and azimuthal order (integers, abs(m) ≤ l). |
| `data-radius` | `100` | **The only size:** the star's radius (at rest) in slide pixels. Its box is the star plus just enough room for the pulsation (and the label below it, if any). |
| `data-x`, `data-y` | — | Place it freely: the star's centre goes to this fraction of the slide (0–1; x from the left, y from the top); its label stays below it. It then leaves the slide's layout (rows, corners, ...). |
| `data-amp` (or `data-pulse-amplitude`) | `0.1` | Largest fractional change of the radius. |
| `data-rate` (or `data-pulse-rate`) | `0.5` | Pulsations per second. |
| `data-spin` (or `data-spin-rate`) | `0.3` | Rotation, radians per second (0.3 ≈ one turn in 21 s). |
| `data-colors` | `#ff1a1a,#ffffff,#1a4dff` | Colors for [moving in, nodes, moving out]: red in, blue out, like a Doppler shift. |
| `data-color-gamma` | `1` | 1 = smooth color change across the nodal lines; > 1 = wider, softer white bands; < 1 = thinner bands but a sharp crease at every node. |
| `data-color-mode` | `velocity` | `velocity` (colors show which way the surface moves), `displacement` (pushed out / pulled in) or `pattern` (fixed pattern). |
| `data-segments` | `auto` | Mesh resolution (longitude segments). |
| `data-grid`, `data-grid-spacing`, `data-grid-color`, `data-grid-width`, `data-grid-opacity` | off, `30`, `#000`, `1.5`, `0.6` | Latitude/longitude lines. |

## Starting on a press

| Attribute | Default | Meaning |
|---|---|---|
| `data-pulse-step` | off | The star starts at rest: a plain round sphere, not turning (with the default colors: white). On the next press it starts pulsing in its mode and turning; "back" brings it to rest again. A number places the step like `data-fragment-index`. |
| `data-ramp-time` | `1` | Seconds to get going / come to rest. |

## Cut open: sound rays

```html
<div class="star" data-l="21" data-m="9" data-pulse-step data-cut data-cut-step data-rays="1, 5, 21"></div>
```

A wedge facing the viewer opens, and inside the sound rays of the modes travel through the star, exactly as
in the stellar star's `rays` interior (see docs/stellar.md, "Sound rays"). Only the outer rim of the cut faces
follows the pulsating surface (the inside stays still), and the opening keeps facing you while the star turns.

| Attribute | Default | Meaning |
|---|---|---|
| `data-cut` | off | The star can be cut open. |
| `data-cut-step` | — | Opens on this press (a number places it like `data-fragment-index`). |
| `data-cut-close-step` | — | Closes again on this press. |
| `data-cut-open` | off | Open from the start. |
| `data-cut-angle` | `90` | Opening of the wedge in degrees. |
| `data-cut-duration` | `1.5` | Seconds to open / close. |
| `data-cut-color` | `#f3e7d3` | The inside. |
| `data-rays` | this star's l | Degrees l of the modes whose rays are traced (repeat one, `1, 1, 1`, for several rays of it); `none` = no rays. |
| `data-ray-frequencies` | `1` | Each mode's frequency in units of the pulsation rate (`data-rate`), one per mode; one value = all modes. |
| `data-ray-omega` | `25` | The pulsation rate's angular frequency in the rays' units (core sound speed / radius). |
| `data-ray-trail`, `data-ray-speed`, `data-ray-colors`, `data-ray-width` | | As for the stellar star. |

## Caption

| Attribute | Meaning |
|---|---|
| `data-label` | Automatic caption *ℓ* = 3, *m* = 2. |
| `data-label="text"` | Your text: `{l}` `{m}` are replaced, `\ell` etc. become symbols, `*x*` is italic. |
| `data-label-color` | Text color. |
| `data-label-offset` | Gap in px between the star's box and its label (default 4; negative = closer). |

## From JavaScript

`createStar(container, options)` → `{ start, stop, setPulsing(on, snap), openCut, closeCut, snapCut(open), set, dispose }`. Options: `l, m, segments, pulseRate,
pulseAmplitude, spinRate, still, rampTime, colors, colorGamma, colorMode, grid, gridSpacing, gridColor, gridWidth, gridOpacity`.
