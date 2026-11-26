# Pendulum graph — "imagine we measured the pendulum"

File: `plugins/pendulumGraph.js` (standalone: it does not use the general graph plugin).

```html
<div class="pendulum-graph" data-amplitude="1" data-period="2" data-t="0,8">
  <span class="fragment fade-in" data-show="period">Period <em>T</em> = 2 s</span>
  <span class="fragment fade-in" data-show="amplitude">Amplitude <em>A</em> = 1 m</span>
</div>
```

The bob's position x(t) = A cos(2πt/T) (an ideal pendulum released at t = 0, exactly like the pendulum
slide) appears as measured points, traced by a ball in real time, each time the slide is shown.

## Period and amplitude: your own reveal fragments

The two children are plain reveal fragments, so reveal fades them in on "next" and out on "back".
Any fragment style works (`fade-in`, `fade-up`, `zoom-in`, `highlight-…`), and so does `data-fragment-index`.
The routine only places them and draws their arrows. Leave one out and it is not shown.
The content is HTML, so `<em>T</em>` is italic.

Example: the period arrow between the 2nd and 3rd peak, below the curve with its label underneath,
and the amplitude label to the left of its arrow, a bit higher:

```html
<span class="fragment fade-in" data-show="period" data-from="2" data-y="-1.25" data-label="below">Period <em>T</em> = 2 s</span>
<span class="fragment fade-in" data-show="amplitude" data-at="1" data-label="left" data-dy="-20">Amplitude <em>A</em> = 1 m</span>
```

| On the child | Default | Meaning |
|---|---|---|
| `data-show` | — | `period` (double arrow between two peaks, label above) or `amplitude` (arrow from 0 to a peak, label to its right). |
| `data-from` | `1` | Period arrow from peak n to peak n + 1 (peaks are at t = 0, T, 2T, …). Decimals work: `1.5` starts halfway between two peaks. |
| `data-y` | just above the peaks | Period arrow: its height, in y-axis units (e.g. `-1.2` = below the curve). |
| `data-at` | `3` | Amplitude arrow on peak n. |
| `data-label` | `above` (period), `right` (amplitude) | Where the label sits next to its arrow: `above`, `below`, `left`, `right`. |
| `data-dx`, `data-dy` | `0` | Nudge the label (px; `dx` > 0 = right, `dy` > 0 = down). |
| `data-color` | yellow / green | Arrow and label color. |

## Graph attributes

| Attribute | Default | Meaning |
|---|---|---|
| `data-amplitude`, `data-period` | `1`, `2` | A (y units) and T (seconds). Match the pendulum slide's `data-period`. |
| `data-t` | `0,8` | Time axis range in seconds. |
| `data-dt` | `0.05` | Seconds between measured points. |
| `data-y` | `-1.4A,1.4A` | y range. |
| `data-x-step`, `data-y-step` | `1`, `A/2` | Tick spacing. |
| `data-x-label`, `data-y-label` | `Time [s]`, `<em>x</em> [m]` | HTML allowed. |
| `data-speed` | `1` | 1 = real time; 0.5 = half speed. |
| `data-point-color`, `data-point-radius` | `#9aa7b8`, `4` | |
| `data-ball`, `data-ball-color`, `data-ball-radius` | on, `#ff5e5e`, `9` | |
| `data-axis-color`, `data-axis-width`, `data-zero-line` | `#fff`, `3`, on | |
| `data-font-size`, `data-tick-font-size` | `26`, `18` | |
| `data-period-from`, `data-amplitude-at` | `1`, `3` | Defaults for the children's `data-from` / `data-at`. |
| `data-period-color`, `data-amplitude-color`, `data-arrow-width` | `#ffd166`, `#50fa7b`, `3.5` | |
| `data-width`, `data-height`, `data-padding="t,r,b,l"` | `1100`, `480`, `40,30,80,100` | |
