# Graph plugin — animated time series and spectra

Files: `plugins/graphPlugin.js` (slide element), `plugins/graph.js` (drawing), `plugins/timeseries.js` (loading data, FFT).

```html
<div class="graph" data-src="data/spb.txt" data-x="0,20" data-y-label="Brightness [mmag]"></div>
```

A graph is drawn on a canvas. When its slide appears, the curve is **traced** from left to right
(optionally with a ball at its tip, optionally in step with a sound). Child elements add arrows,
lines, bands, labels and zooms, which can appear one by one on "next".

## Data sources (pick one)

| Attribute | Meaning |
|---|---|
| `data-src="file.txt"` | A text table: columns separated by spaces, tabs, commas or semicolons. Lines starting with `#`, `%` or `//` are skipped; a first line of column names is allowed. Rows with `NaN` are skipped (gaps are fine). |
| `data-src="sound.mp3"` | An audio file (`.mp3 .wav .ogg .m4a .flac …`): its waveform, time in seconds, channels averaged. |
| `data-fn="A*cos(2*PI*t/T)"` | A formula of `t` (seconds). Allowed: numbers, `+ - * / ^ ( )`, `t`, `A`, `T`, `PI`, `E`, `sin cos tan exp log sqrt abs …`. |

Options for text files:

| Attribute | Default | Meaning |
|---|---|---|
| `data-columns` | `0,1` | Which columns are time and value: indices (`0,1`) or names from the header (`time,flux`). |
| `data-time-unit` | `d` | Unit of the time column: `s`, `min`, `h`, `d`. |
| `data-time-zero` | `first` | `first` = the series starts at t = 0; a number (in time units); or `none`. |

Options for formulas:

| Attribute | Default | Meaning |
|---|---|---|
| `data-t` | `0,10` (`0,100` for spectra) | Sample from t = a to b seconds. |
| `data-dt` | `0.05` | Seconds between samples. |
| `data-amplitude`, `data-period` | `1`, `2` | The values of `A` and `T` in the formula. |
| `data-noise` | `0` | Gaussian "measurement" noise added to every sample. |
| `data-seed` | `1` | Different seed = different noise. |

## Time series or spectrum

| Attribute | Default | Meaning |
|---|---|---|
| `data-mode` | `time` | `time` = the series itself; `fourier` = its amplitude spectrum (a sine of amplitude A gives a peak of height A); `spectrum` = the file already is a spectrum (columns frequency, amplitude), drawn as it is. |
| `data-freq-unit` | `c/d` | `data-mode="spectrum"`: unit of the file's frequency column (`Hz mHz uHz c/d c/h`). |
| `data-x-unit` | the time unit / `Hz` or `c/d` | Unit of the x axis. Time: `s min h d`. Frequency: `Hz mHz uHz c/d c/h`. |
| `data-y-scale` | `1` | Multiply the values (e.g. `1000` to go from relative flux to ppt). |
| `data-subtract-mean` | `false` | Subtract the mean (time mode; spectra always do). |
| `data-oversample` | `4` | Zero padding of the FFT: finer frequency grid, smoother peaks. |

Unevenly sampled data (gaps, as in most light curves) is put on a regular grid at the typical cadence
with the gaps filled with zeros. That is fine for a picture, not for science.

## Window and axes

| Attribute | Default | Meaning |
|---|---|---|
| `data-x="a,b"` | all data | Visible x range (in `data-x-unit`). |
| `data-window` | none | Show only this much x at a time (e.g. `10` = 10 days). The trace still runs over the whole x range (so a sound stays in sync), and the window moves along once the tip reaches its right edge; afterwards the last stretch stays. The y range stays that of the whole range. |
| `data-y="c,d"` | fit | Visible y range. `auto` = fit the data inside the x window. |
| `data-y-from-zero` | on for spectra | The automatic y range starts at 0. |
| `data-y-log`, `data-y-log-decades` | off, `4` | Logarithmic y axis, showing this many decades below the maximum. |
| `data-x-step`, `data-y-step` | automatic | Tick spacing. |
| `data-x-label`, `data-y-label` | `Time [d]`, `Signal` / `Frequency [Hz]`, `Amplitude` | Axis labels. `*x*` is italic, `\nu` → ν (see "Labels" below). |
| `data-ticks` | `true` | `false` hides ticks and numbers (for small sketch-like graphs). |
| `data-width`, `data-height` | `900`, `450` | Size in slide pixels. |
| `data-font-size`, `data-tick-font-size`, `data-tick-size` | `26`, `18`, `8` | Text and tick sizes. |
| `data-axis-color`, `data-axis-width`, `data-axis-arrows` | `#fff`, `3`, `true` | Axes. |
| `data-text-color` | slide text color | |
| `data-padding="t,r,b,l"` | automatic | Space around the plot in px. |

## The curve

| Attribute | Default | Meaning |
|---|---|---|
| `data-style` | `line` | `line`, `points` or `both`. |
| `data-color` | `#72d7e9` | |
| `data-line-width` | `1.5` | Thickness of the data line (slide pixels; the traced, animated line too). |
| `data-smooth` | on | Smooth curve through points that are more than a pixel apart. `data-smooth="false"` = straight lines between points. |
| `data-fill` | `0` | Opacity of the area under the curve (nice for spectra, e.g. `0.25`). |
| `data-point-color`, `data-point-radius` | color, `4` | |
| `data-ball` | off | A glowing ball at the tip of the trace. |
| `data-ball-color`, `data-ball-radius` | `#ff5e5e`, `9` | |

## Animation and sound

| Attribute | Default | Meaning |
|---|---|---|
| `data-animate` | `trace` (`grow` for spectra) | `trace` = draw from left to right; `grow` = the whole curve rises from y = 0 to full height, like a histogram filling up; `none` = show at once. |
| `data-duration` | `4` (`2` for spectra) | Seconds for the trace. `realtime` = as fast as the time axis (a 8 s window takes 8 s; with `data-speed`). |
| `data-speed` | `1` | Speed factor for `realtime`. |
| `data-play-step` | — | The trace starts on the next press instead of when the slide appears. A number places it like `data-fragment-index`. |
| `data-sound-step` | — | With `data-audio`: the trace starts silently (on its play step), and the sound comes in on the next press, at the point the trace has reached; from then on the trace follows the sound. Back silences it again. |
| `data-loop` | — | When the trace reaches the end it starts over (with `data-audio`, the sound loops too). |
| `data-audio="file.mp3"` | — | Play this sound with the trace. The trace then lasts as long as the sound. |
| `data-audio` (no value) | — | Play the source itself (when `data-src` is an audio file); the tip of the curve follows the sound exactly. |
| `data-audio-max` | — | Stop the sound (and end the trace) after this many seconds — for long sonifications. |
| `data-audio-volume` | `1` | |
| `data-audio-sync` | automatic | `time` (tip = sound's time) or `progress` (trace spread over the sound's length). |
| `data-zoom-duration` | `1.2` | Seconds for a zoom. |

Going back to a slide (from a later one) shows the finished trace without replaying the sound.

## Annotations: child elements

Put them inside the graph. They are ordinary reveal fragments: with `class="fragment"` reveal fades them in on
"next" and out on "back", using any fragment style you give them (`fade-in`, `fade-up`, `zoom-in`,
`fade-in-then-out`, …) and `data-fragment-index`. Without `class="fragment"` they are always there. The graph
only draws them (as SVG on top of the canvas) and keeps them attached to the data when it zooms.
Coordinates are in the graph's own units. Text is either the element's content or `data-label`.

```html
<div class="graph" data-fn="A*cos(2*PI*t/T)" data-t="0,8" data-y="-1.4,1.4">
  <span class="graph-line" data-y="0" data-color="rgba(255,255,255,0.3)"></span>          <!-- always -->
  <span class="fragment graph-arrow" data-from="2,1.15" data-to="4,1.15" data-heads="both">Period *T* = 2 s</span>
  <span class="fragment graph-arrow" data-from="6,0" data-to="6,1" data-label-align="left"
        data-label-offset="0.6,0" data-color="#50fa7b">Amplitude *A*</span>
</div>
```

| Element | Attributes |
|---|---|
| `graph-arrow` | `data-from="x,y"`, `data-to="x,y"`, `data-heads` = `end` / `both` / `start` / `none`, `data-label-offset="dx,dy"` (in label heights, from the middle; default `0,-1` = above), `data-label-align` = `center` / `left` / `right` |
| `graph-line` | `data-x="x1,x2,…"` (vertical lines) and/or `data-y="…"` (horizontal), `data-labels="a,b,…"` (one per line), `data-dash="8,6"` or `none` |
| `graph-band` | `data-x="a,b"`, optional `data-y="c,d"`, `data-opacity` (default 0.18), label above |
| `graph-label` | `data-at="x,y"` (y may be `top` or `bottom`), `data-align`, `data-bold` |
| `graph-zoom` | `data-x="a,b"`, `data-y="c,d"` or `auto`, `data-x-step`, `data-y-step`, `data-duration` — zooms to that window on its press; back zooms out again |

All of them take `data-color`, `data-width` (line width) and `data-size` (font size).
`data-behind` puts one behind the data: the curve and its fill are drawn over it, so frequency lines
do not hide the peaks they mark (`<span class="fragment graph-line" data-behind data-x="110,220">`).

Useful fragment styles:
- `class="fragment fade-in-then-out graph-band"` — shown on its press, gone on the next (e.g. mark the region, then zoom in);
- `class="fragment fade-out graph-…"` — shown until its press;
- `data-fragment-index="2"` — places it like any reveal fragment (same number = same press).

`graph-zoom` is the exception: it has nothing to show, so it is just a step.

## Labels

In axis labels and annotation texts: `*x*` is italic, `\nu` → ν, `\ell` → ℓ, `\Delta` → Δ, `\odot` → ☉,
`\mu`, `\omega`, `\pi`, `\theta`, `\deg`, `\times`, `\pm`, `\approx` (full list: `SYMBOLS` in `plugins/lib/revealHelpers.js`).

## Examples

```html
<!-- light curve in days, shown in hours, zoom to 6 h on "next" -->
<div class="graph" data-src="data/sun.txt" data-time-unit="d" data-x-unit="h">
  <span class="fragment graph-zoom" data-x="0,6"></span>
</div>

<!-- its spectrum in µHz -->
<div class="graph" data-mode="fourier" data-src="data/sun.txt" data-x-unit="uHz" data-x="0,8000"></div>

<!-- a ready-made spectrum (e.g. lightkurve's periodogram, frequency per day) -->
<div class="graph" data-mode="spectrum" data-src="data/PG_SPB_KIC10526294.txt" data-x="0,2" data-y-scale="100"
    data-y-label="Amplitude [%]"></div>

<!-- light curve synced to a sonification that spreads the whole file evenly over 60 s -->
<div class="graph" data-src="data/LC_SPB_KIC10526294.txt" data-play-step
    data-audio="media/LC_SPB_KIC10526294.mp3" data-duration="60" data-window="20"></div>

<!-- 1st press: the trace runs silently and keeps starting over; 2nd press: its sound comes in, in sync -->
<div class="graph" data-src="data/LC_SPB_KIC10526294.txt" data-play-step data-sound-step data-loop
    data-audio="media/LC_SPB_KIC10526294.mp3" data-duration="60" data-window="20"></div>

<!-- a recording, sound and trace together on "next" -->
<div class="graph" data-src="media/a-string.mp3" data-audio data-play-step data-y="-1,1"></div>

<!-- a light curve with a separate sonification, stopped after 30 s -->
<div class="graph" data-src="data/dsct.txt" data-x="0,1" data-audio="media/dscuti.mp3" data-audio-max="30" data-play-step></div>
```

## From JavaScript

```js
import { createGraph } from './plugins/graph.js';
const g = createGraph(div, { width: 800, height: 400, style: 'both' });
g.setData({ x: Float64Array.from(...), y: Float64Array.from(...) });
g.play({ duration: 3 });
g.setView({ x: [0, 2], y: null });          // zoom (y null = fit)
```
Handle: `start stop setData setMessage setView play clear showAll setAnnotations redraw set dispose`.
