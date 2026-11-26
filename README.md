# astro-presentation

A reveal.js setup for astronomy outreach talks: a 3D starfield theme and animated slide elements —
rotating stars that can be cut open, pulsating stars (spherical harmonics), animated graphs of light
curves / sound files and their spectra, a guitar that wiggles and can be plucked, a pendulum, and sounds.

Everything is controlled from HTML attributes, and everything steps with reveal's **next** (space,
right arrow, presenter clicker) and is undone by **back**.

`index.html` is the template for *The stars sing* (a 15 minute public talk on asteroseismology).
`starter.html` is an empty deck with all plugins loaded, for a new talk.

## Quick start

```bash
python3 tools/serve.py
```

This opens `http://localhost:8000/index.html`. (A server is needed because browsers do not load
JavaScript modules or data files from `file://` pages. Any static server works, e.g.
`npx serve` or `python3 -m http.server`; `tools/serve.py` also turns off caching so a reload shows your latest edit.)

Keys: **S** speaker notes (with the script's lines), **F** fullscreen, **O** / **Esc** overview, **B** black screen.
Add `?print-pdf` to the URL to print to PDF.

The folder is self-contained: copy or clone it anywhere and run the command above.
Only three.js and the Lato font come from the internet — see *Offline*.

## Plugins

| Element | Plugin | Docs |
|---|---|---|
| `<div class="graph">` | Animated time series / spectrum from a table, an audio file or a formula; zoom, arrows, sound | [docs/graph.md](docs/graph.md) |
| `<div class="stellar">` | Rotating glowing star, granulation, spots, cut-open interior | [docs/stellar.md](docs/stellar.md) |
| `<div class="star">` | Pulsating star showing one spherical harmonic | [docs/pulsating-star.md](docs/pulsating-star.md) |
| `<div class="guitar">` | Guitar with pluckable strings and cartoon body wiggle | [docs/guitar.md](docs/guitar.md) |
| `<div class="pendulum">` | Pendulum with release step and measurement arrow | [docs/pendulum.md](docs/pendulum.md) |
| `data-sound="file"` | Play a sound on a press | [docs/sound.md](docs/sound.md) |
| theme | Starfield background, colors, layout classes (`row`, `column`, `corners`, …) | [docs/theme.md](docs/theme.md) |

How to add your own: [docs/writing-plugins.md](docs/writing-plugins.md).

## Steps while presenting

Two ways to make something happen on a press of "next":

- **a child element with `class="fragment"`** — it appears on that press. For graphs these are
  arrows, lines, bands, labels and zooms (`<span class="fragment graph-zoom" data-x="0,6"></span>`).
- **a `data-...-step` attribute on an element** — the element does something on that press:
  `data-cut-step` (star opens), `data-play-step` (graph traces, sound plays), `data-wiggle-step`
  (guitar wiggles), `data-swing-step` / `data-arrow-step` (pendulum).

Steps happen in document order; give a number (`data-cut-step="2"`, `data-fragment-index="2"`) to
reorder or to make two things happen on the same press. Going back, or jumping to a slide, always
lands in the right state.

## Folder layout

```
index.html              the talk (template)
starter.html            empty deck for a new talk
plugins/                slide elements (…Plugin.js = reveal side, the rest = drawing / maths)
  lib/revealHelpers.js  shared helpers: options from attributes, steps, lazy start/stop
theme/                  astro.scss (source) → astro.css, starfield.js, fonts
data/demo/              SYNTHETIC light curves so the template works — replace with real data
media/                  sound files
docs/                   one page per plugin
tools/                  serve.py (local server), make_demo_data.py
vendor/reveal/          reveal.js 6 (dist files + theme template), MIT licence
```

## Your own data

A light curve is any text table with time and brightness columns:

```
# comments are fine
# time  flux
1325.2934  1.00021
1325.2948  0.99987
```

Point a graph at it: `<div class="graph" data-src="data/my-star.txt" data-time-unit="d">`.
Columns by number or name: `data-columns="time,flux"`. Gaps and NaN rows are fine. For TESS / Kepler
data, export the light curve to CSV first (e.g. with `lightkurve`: `lc.to_csv('my-star.csv')` and
`data-columns="time,flux"`).

## Offline (at the venue)

three.js is loaded from a CDN (see the `importmap` in `index.html`). To run without internet:

```bash
npm install
npm run vendor
```

and change the import map to `"three": "./vendor/three/three.module.js"`.
Without the Lato font the slides fall back to a system sans-serif.

## Licence

reveal.js is MIT licensed (`vendor/reveal/LICENSE`).
