# Pendulum

Files: `plugins/pendulumPlugin.js` (slide element), `plugins/pendulum.js` (drawing).

```html
<div class="pendulum" data-length="330" data-angle="30" data-period="2" data-raise-step data-swing-step data-arrow-step></div>
```

The bob moves as x(t) = cos(2πt/T) after release, i.e. the same curve as `data-fn="A*cos(2*PI*t/T)"` in a graph —
so a pendulum slide followed by a graph slide shows the same motion.

## Steps

| Attribute | Effect |
|---|---|
| `data-raise-step` | Hangs straight down; lifted to its starting angle on a press (`data-raise-duration`, default 1.2 s). Comes before the swing step. |
| `data-swing-step` | Held at its starting angle; let go on the next press. Without it, it swings as soon as the slide appears. |
| `data-arrow-step` | The measurement arrow (sideways displacement *x*) appears on a press. |
| `data-arrow` | The arrow is always shown. |

## Look

| Attribute | Default | Meaning |
|---|---|---|
| `data-width`, `data-height` | `900`, `520` | Canvas size. |
| `data-x`, `data-y` | — | Place it freely: its centre goes to this fraction of the slide (0–1; x from the left, y from the top). It then leaves the slide's layout (rows, corners, ...). |
| `data-length` | `330` | Rod length (px). |
| `data-angle` | `30` | Amplitude in degrees. |
| `data-period` | `2` | Seconds per full swing. |
| `data-pivot-y` | `30` | Pivot distance from the top. |
| `data-pivot-size`, `data-rod-width`, `data-bob-size` | `16`, `4`, `44` | |
| `data-pivot-color`, `data-pivot-border-color`, `data-rod-color`, `data-bob-color` | | |
| `data-ref-line`, `data-ref-line-color` | on | Dashed line through the rest position. |
| `data-arrow-color`, `data-arrow-width`, `data-arrow-y` | `#fff`, `4`, below the bob | |
| `data-label` | `*x*` | Text before the value (`*…*` italic). |
| `data-units` | — | e.g. ` m`. |
| `data-label-color`, `data-font-size`, `data-decimals` | `#fff`, `30`, `1` | |
