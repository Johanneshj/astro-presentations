# Guitar — a wiggling cartoon guitar

Files: `plugins/guitarPlugin.js` (slide element), `plugins/guitar.js` (drawing + wiggle modes),
`plugins/guitarGeometry.js` (shape — edit this to change the outline and neck).

```html
<div class="guitar" data-width="1000" data-height="466">
    <span class="fragment" data-wiggle="edge"></span>                  <!-- 1st press: waves around the edge -->
    <span class="fragment" data-wiggle="breathe, bend, neck"></span>   <!-- 2nd: it turns, the whole guitar moves -->
    <span class="fragment" data-wiggle="none"></span>                  <!-- 3rd: calms down, turns back -->
</div>
```

Each child with `data-wiggle` is a step: when its fragment shows, the guitar wiggles in those modes
(the last shown step wins, so "back" undoes it; `data-fragment-index` works as usual). `data-wiggle`
on the guitar itself = wiggle as soon as the slide appears.

## Modes

Not a model of a real guitar, but each mode is a kind of motion guitars really make.

| Mode | Kind | What it shows |
|---|---|---|
| `edge` | in the plane | Small waves running around the edge of the body. Seen from the front. |
| `breathe` | top plate | The top swells in and out (the "monopole" that pumps air through the hole). |
| `cross` | top plate | One side of the lower bout up, the other down ("cross dipole"). |
| `long` | top plate | Lower and upper bout opposite ("long dipole"). |
| `bend` | whole guitar | The instrument flexes like a free bar: ends one way, middle the other. |
| `neck` | whole guitar | The neck swings like a diving board. |

The top-plate and whole-guitar modes move out of the plane of the top, which you cannot see from the
front. So for them the guitar first **turns** to `data-wiggle-tilt` degrees (like a computer model of
a vibrating guitar), where the bending shows. It stays a flat surface while it turns (no box). When they stop, it calms down first and then turns back. Switching between steps fades the old modes out and the new ones in.

Frequencies, sizes, shapes and the number of edge waves: `WIGGLE_MODES` at the top of `guitar.js`.

## Attributes

| Attribute | Default | Meaning |
|---|---|---|
| `data-wiggle` | — | Modes to wiggle in from the start (comma separated). |
| `data-wiggle-amount` | `1` | Overall size. |
| `data-wiggle-speed` | `1` | Overall speed. |
| `data-wiggle-ramp` | `0.8` | Seconds to fade a mode in / out. |
| `data-tilt` | `0` | View angle at rest (degrees; 0 = from the front). |
| `data-wiggle-tilt` | `60` | View angle while top-plate / whole-guitar modes run. Same as `data-tilt` = no turning. |
| `data-yaw` | `0` | Turn about the vertical (degrees). |
| `data-angle` | `0` | Rotation in the slide's plane (degrees). |
| `data-turn-time` | `1.2` | Seconds to turn. |
| `data-width`, `data-height` | `800`, `373` | Size in slide pixels; the guitar is fitted so it stays inside in every pose. |
| `data-x`, `data-y` | — | Place it freely: its centre goes to this fraction of the slide (0–1; x from the left, y from the top). It then leaves the slide's layout (rows, corners, ...). |
| `data-body-color`, `data-edge-color`, `data-neck-color`, `data-head-color`, `data-hole-color`, `data-fret-color`, `data-nut-color` | browns | Colors. |

## From JavaScript

`createGuitar(container, options)` → `{ start, stop, setWiggle('edge' | ['bend', 'neck'] | 'none', snap), wiggle, set, dispose }`.
`setWiggle(modes, true)` jumps there at once (no fading or turning).
