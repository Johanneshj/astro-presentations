# Guitar — clickable strings and a wiggling body

Files: `plugins/guitarPlugin.js` (slide element), `plugins/guitar.js` (drawing + wiggle),
`plugins/guitarGeometry.js` (shape — edit this to change the guitar's outline), `plugins/stringModes.js` (string physics).

```html
<div class="guitar" data-width="1000" data-height="466" data-strings="false" data-wiggle="breathe, bend" data-wiggle-step></div>
```

Click or drag a string to pluck it (it vibrates in slow motion as a sum of its real modes).

## Wiggle (cartoon body modes)

Not a model of a real guitar, but each mode is a kind of motion guitars really make. Red patches move
towards you, blue away — the same colors as the spherical-harmonic stars, which makes the link to
stars easy later.

| Mode | What it shows |
|---|---|
| `breathe` | The top plate swells in and out (the "monopole" that pumps air through the sound hole); the hole breathes too. |
| `cross` | One side of the lower bout up, the other down ("cross dipole"). |
| `long` | Lower and upper bout opposite ("long dipole"). |
| `bend` | The whole instrument flexes like a free bar (ends one way, middle the other). |
| `neck` | The neck swings like a diving board. |

Frequencies, sizes and patch positions: `WIGGLE_MODES` at the top of `guitar.js`.

| Attribute | Default | Meaning |
|---|---|---|
| `data-wiggle` | `breathe, bend` | Which modes (comma separated). Without a step, it wiggles as soon as the slide appears. |
| `data-wiggle-step` | — | Start wiggling on the next press. |
| `data-wiggle-stop-step` | — | Calm down on a later press. |
| `data-wiggle-amount` | `1` | Overall size. |
| `data-wiggle-speed` | `1` | Overall speed. |
| `data-wiggle-ramp` | `0.8` | Seconds to fade in / out. |
| `data-wiggle-patches` | `true` | Show the red / blue patches. |
| `data-wiggle-colors` | `#1a4dff,#ff1a1a` | [away, towards]. |
| `data-wiggle-opacity` | `0.7` | |

## Strings and look

| Attribute | Default | Meaning |
|---|---|---|
| `data-strings` | `true` | `false` = a guitar without strings. |
| `data-strum-step` | — | All six strings are strummed on a press (pair it with a `data-sound` fragment of the same index for sound). |
| `data-width`, `data-height` | `800`, `373` | Size in slide pixels (keep the ratio ≈ 2.15). |
| `data-slowdown` | `100` | Slow motion factor for the strings. |
| `data-decay-time`, `data-decay-slope` | `5`, `0.5` | How long the strings ring; how much faster overtones die. |
| `data-stiffness` | `0` | Inharmonicity (0.0001–0.001 for real strings). |
| `data-pluck-height`, `data-max-pull` | `8`, `18` | mm. |
| `data-max-display-hz` | `20` | Modes faster than this on screen are left out. |
| `data-interactive` | `true` | `false` = no mouse plucking. |
| `data-body-color`, `data-edge-color`, `data-neck-color`, `data-head-color`, `data-hole-color`, `data-string-color`, `data-hold-color` | browns | Colors. |

## From JavaScript

`createGuitar(container, options)` → `{ start, stop, pluck(i, xFrac, height), strum(), wiggle('breathe, neck'), stopWiggle(), snapWiggle(on), set, dispose }`.
