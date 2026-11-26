# Stellar plugin — a rotating, glowing star that can be cut open

Files: `plugins/stellarPlugin.js` (slide element), `plugins/stellar.js` (three.js star). Needs three.js (see README, "Offline").

```html
<div class="stellar" data-size="500" data-temperature="5800" data-texture="granulation"></div>
```

## Look

| Attribute | Default | Meaning |
|---|---|---|
| `data-size` | `500` | Canvas width = height in slide pixels (the canvas is transparent). |
| `data-radius` | `0.45` | Star radius as a fraction of half the canvas (1 = touches the edge; the glow needs room). |
| `data-color` | `#ffb347` | Any CSS color. |
| `data-temperature` | — | Kelvin; replaces the color (3500 red dwarf, 5800 Sun, 15000 blue). |
| `data-rotation-period` | `20` | Seconds per turn; 0 = still; negative = the other way. |
| `data-tilt` | `20` | Degrees the axis leans towards you. |
| `data-limb-darkening` | `0.6` | 0 = flat disc, 1 = strongly darker edge. |
| `data-glow` | `0.6` | Glow brightness (0 = none). |
| `data-glow-size` | `1.0` | How far the corona reaches. |
| `data-glow-rim` | `1.0` | Bright thin rim at the edge. |
| `data-glow-rays` | `0.5` | Faint streaks in the corona (0 = smooth). |
| `data-grid`, `data-grid-spacing` | off, `30` | Latitude/longitude lines (to see the rotation). |

## Surface texture

| Attribute | Default | Meaning |
|---|---|---|
| `data-texture` | `none` | `none`, `granulation`, `spots`, `both`. |
| `data-granulation` | from texture | Strength 0..1. |
| `data-granulation-scale` | `10` | Cells across the radius: smaller = bigger, more cartoonish cells. |
| `data-granulation-speed` | `1` | How fast the cells boil. |
| `data-spots`, `data-spot-size`, `data-spot-latitude`, `data-spot-seed` | from texture, `7`, `30`, `1` | Number (max 24), size in degrees, latitude band, random pattern. |

## The cut (interior)

| Attribute | Default | Meaning |
|---|---|---|
| `data-cut` | off | The star can be cut open to show its zones. |
| `data-cut-open` | off | Already open when the slide appears. |
| `data-cut-animate` | `true` | `false` = snaps open. |
| `data-cut-duration` | `2` | Seconds to open / close. |
| `data-cut-angle` | `90` | Opening of the wedge in degrees (max 180). |
| `data-cut-direction` | `0` | Degrees around the axis (0 = facing you). |
| `data-structure` | `sun` | `sun`, `red-giant`, `massive`, `dwarf`. |
| `data-zones` | — | Your own zones from the centre out, e.g. `radiative:0.71, convective:1`. |
| `data-radiative-color`, `data-convective-color` | from the star color | |
| `data-centre-white` | `0.45` | How much whiter the cut gets towards the centre. |
| `data-arrows` | `true` | Wiggly arrows (radiative) and loops (convective). |
| `data-arrow-color`, `data-arrow-opacity`, `data-arrow-speed`, `data-radiative-arrows` | `#000`, `0.55`, `1`, `5` | |

Arrow shapes: `ARROW_STYLE` at the top of `stellar.js`. Structures: `STRUCTURES` in `stellar.js`.

## Opening while presenting

Everything follows reveal's "next" (space, right arrow, clicker); "back" undoes it.

| Where | Attribute | Effect |
|---|---|---|
| `<section>` | `data-stellar-open` | Next press opens every cut star on the slide. |
| `<section>` | `data-stellar-close` | ... and the press after that closes them. |
| star | `data-cut-step` | This star opens on its own press (in document order, or `="2"` like `data-fragment-index`). |
| star | `data-cut-close-step` | ... and closes on a later press. |
| star | `data-cut-click` | A mouse click on the star also toggles it. |

## From JavaScript

`createStellar(container, options)` → `{ start, stop, resetCut, snapCut, openCut, closeCut, toggleCut, set, dispose }`.
Option names are the attribute names in camelCase (`rotationPeriod`, `cutAngle`, …).
