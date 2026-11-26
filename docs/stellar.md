# Stellar plugin — a rotating, glowing star that can be cut open

Files: `plugins/stellarPlugin.js` (slide element), `plugins/stellar.js` (three.js star). Needs three.js (see README, "Offline").

```html
<div class="stellar" data-radius="110" data-temperature="5800" data-texture="granulation"></div>

<!-- the same star with a quarter cut out; each quarter of the cut shows one ingredient of a star -->
<div class="stellar-quarter" data-radius="150" data-cut-step data-regions="hydrostatic, burning, opacity, transport"></div>
```

Both elements take every attribute on this page. `stellar-quarter` only starts from different
defaults: `data-cut`, `data-cut-angle="90"` and `data-regions="hydrostatic, burning, opacity, transport"`.

## Look

| Attribute | Default | Meaning |
|---|---|---|
| `data-radius` | `120` | **The only size:** the star's radius in slide pixels. Its box on the slide (the canvas) is the star plus its whole glow: 2 × radius × (1 + 0.5 × glow-size) across, so 3 × radius by default. Nothing spills out of the box. |
| `data-glow-size` | `1` | How far the glow reaches (and so how much room the box leaves around the star): `0.5` = a tighter box, e.g. for a big star that must fit on the slide. |
| `data-x`, `data-y` | — | Place it freely: its centre goes to this fraction of the slide (0–1; x from the left, y from the top). It then leaves the slide's layout (rows, corners, ...). For a star: the star's centre. |
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

## Label

| Attribute | Default | Meaning |
|---|---|---|
| `data-label` | — | A caption centred just below the star's surface, e.g. `data-label="Red Giant"` (`\name` becomes a symbol, `*x*` italic). It moves with the star (also with `data-x` / `data-y`). |
| `data-label-color` | text color | |

The font is the slide titles' (League Gothic); change `--astro-label-font` in `theme/astro.scss` for another.
| `data-label-offset` | `10` | Gap in px between the surface and the label (negative = closer). |

## Surface texture

| Attribute | Default | Meaning |
|---|---|---|
| `data-texture` | `none` | `none`, `granulation`, `spots`, `both`, `mottled`, `bands`, `network` (below). |
| `data-granulation` | from texture | Strength 0..1. |
| `data-granulation-scale` | `10` | Cells across the radius: smaller = bigger, more cartoonish cells. |
| `data-granulation-speed` | `1` | How fast the cells boil. |
| `data-spots`, `data-spot-size`, `data-spot-latitude`, `data-spot-seed` | from texture, `7`, `30`, `1` | Number (max 24), size in degrees, latitude band, random pattern. |
| `data-texture-strength` | `1` | `mottled` / `bands` / `network`: how strong (0.5 = half, 2 = twice). |
| `data-texture-scale` | `2.5` / `7` / `3` | ... their size: more = finer patches, more bands, a finer web. |
| `data-texture-speed` | `1` | ... how fast they drift (0 = frozen). |

Textures without granulation cells:

| `data-texture` | Looks like |
|---|---|
| `mottled` | Soft, cloudy brighter and darker patches that slowly swirl. |
| `bands` | Wavy stripes along the latitudes; the equator turns a little faster, so they slowly shear. |
| `network` | A web of thin bright filaments, like the Sun's magnetic network. |

Spots can be added on top: `data-texture="mottled" data-spots="4"`.

## Accretion disk

A young star still feeding on the gas around it: a flat disk in the star's equator that orbits with it.
Each radius turns at its own (Keplerian) rate, so the streaks wind into slowly shearing spiral arcs.
The star hides the far side of the disk; the near side passes in front of it.

```html
<div class="stellar" data-radius="70" data-color="#ff8a3a" data-tilt="22"
     data-disk data-disk-outer="4.3"></div>
```

| Attribute | Default | Meaning |
|---|---|---|
| `data-disk` | off | Show the disk. |
| `data-disk-inner` | `1.25` | Where the disk proper starts, in stellar radii (a faint glow fills the gap down to the star). |
| `data-disk-outer` | `4` | Its outer edge, in stellar radii. The star's box grows to make room for it. |
| `data-disk-speed` | `1` | Orbit speed (0 = still, negative = the other way). |
| `data-disk-brightness` | `1` | Overall brightness. |
| `data-disk-colors` | `#fff2c4,#ff9440,#9c2a1c` | Colors from the inner edge out: [hot, middle, cool]. |

`data-tilt` sets how much we look down on the disk: 0 = edge-on, 90 = face-on (about 15–30 looks best).

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

## The ingredients of a star: one per quarter

With a 90° cut (a quarter of the star removed; `data-cut-angle` opens it wider), the two flat faces seen together look like a disc in
four quarters. `data-regions` says what each quarter shows, in the order
**clockwise from the upper left**: upper left, upper right, lower right, lower left (left = the face on the left of the opening).
One entry = all quarters; missing entries = plain. Nothing is drawn on top of anything else.

| Attribute | Default | Meaning |
|---|---|---|
| `data-regions` | `zones` (stellar) / `hydrostatic, burning, opacity, transport` (stellar-quarter) | What each quarter shows (names below). |
| `data-core-radius` | `0.2` | r/R of the burning core. When a quarter burns, this radius is marked (dashed) in the zones and photons quarters too, and the radiation wiggles and photon walks start there. |

| Name | Shows | Attributes |
|---|---|---|
| `zones` (or `transport`, `energy transport`) | Radiative and convective zones with their arrows (as before); with a core, the wiggles start at its edge. | `data-structure`, `data-zones`, arrow attributes above |
| `burning` (or `nuclear burning`) | The glowing burning core with rotating radiation trefoils. | `data-core-glow` (0.9; 0 = none), `data-core-glow-color`, `data-burning-symbols` (2; fewer = bigger), `data-burning-size` (0.06 R), `data-burning-speed`, `data-burning-color`, `data-burning-ink` |
| `photons` (or `opacity`) | Photons random-walking from the core all the way out to the surface, leaving black tracks. | `data-photon-walks` (3, max 6), `data-photon-speed` (12 steps per second), `data-photon-color` (`#000`) |
| `hydrostatic` (or `hydrostatic equilibrium`) | Hydrostatic equilibrium: shells (every other one shaded); at each shell boundary gravity presses down from above (blue) and pressure pushes up from below (red). Deeper layers carry more weight, so their arrows are bigger. | `data-hydrostatic-layers` (4, max 8), `data-pressure-color`, `data-gravity-color`; sizes in `INGREDIENT_STYLE` (`hydroLength`, `hydroWidth`, `hydroOuter`, …) |
| `question` (or `unknown`, `?`) | We don't know: just a big question mark. It is drawn as the audience sees it, flat on the screen, so it reads in one piece across both faces (best with the whole star set to it: `data-regions="question"`). | `data-question-color` (`#000`), `data-question-size` (1 ≈ 0.8 stellar radii tall) |
| `rays` (or `p modes`) | Sound (p-mode) rays travelling through the interior, one per mode in `data-rays` (see below). | `data-rays`, `data-ray-*` |
| `plain` | Just the interior color. | |

Shapes and lengths (arrow lengths, photon step, outward bias, trail width): `INGREDIENT_STYLE` at the
top of `stellar.js`.

## Sound rays (`data-regions="rays"`)

```html
<div class="stellar" data-radius="250" data-cut data-cut-step data-regions="rays" data-rays="1, 5, 21"></div>
```

To swap a question mark for rays on the next press (the young star in index.html):

```html
<div class="stellar" data-cut data-cut-step data-regions="question"
     data-regions-step data-regions-next="rays" data-rays="1, 1, 1"></div>
```

Each mode's sound wave is traced as a ray (geometric acoustics, `plugins/lib/rays.js`): it starts at the top
of the star, dives in, bends away from the hot fast centre, turns at its inner turning point (where
c(r)/r = ω/√(l(l+1)), the Lamb frequency; drawn as a dotted circle), comes back up and is reflected at
the surface, skip after skip, for ever. Low degrees dive deep, high degrees stay shallow. Each ray has
an arrowhead at its head (slow near the surface, where sound is slow, fast in the core) and a trail that
fades out behind it, gone before the head comes round to the same place again. It starts from the surface
every time the star opens. The two
faces show one disc between them, so a ray runs on across the fold.

| Attribute | Default | Meaning |
|---|---|---|
| `data-rays` | `2, 20` | The degrees l of the modes, one ray each (up to 6 colours, then they repeat). A degree listed more than once (`1, 1, 1`) gives that many rays of the mode, starting evenly spread round the star. |
| `data-ray-omega` | `25` | The reference angular frequency (units: core sound speed / radius). Higher = every ray dives deeper. |
| `data-ray-frequencies` | `1` | Each mode's frequency in units of `data-ray-omega`, one per mode (`1, 1.4, 2.2`); one value = all modes. Mode i is traced with ω = omega × f. |
| `data-ray-trail` | `0.8` | How long the trail lasts, as a fraction of the ray's time once round the star (below 1: the old path has faded before the head comes round). |
| `data-ray-speed` | `1` | How fast the waves travel (1: l = 1 takes about 3 s, l = 21 about 8 s). |
| `data-ray-colors` | pink, blue, green, orange, purple, teal | One colour per mode. |
| `data-ray-width` | `1` | Thickness of the rays and their arrowheads, as a multiple of the default (`0.6` thinner, `2` twice as thick). |

The sound speed is a simple profile, c(r) = 0.05 + 0.95 (1 − r²)^1.5 (slow at the surface, fast in the
core), in `plugins/lib/rays.js`.

**Bounces are not nodes.** A ray's number of surface reflections is set by how deep it turns, i.e. by
ω/√(l(l+1)), not by l alone: at a fixed l, a lower frequency (fewer radial nodes) turns closer to the
surface and skips more often. The l nodal lines on the surface come from many rays, running every way
round and starting everywhere, interfering; one ray is one strand of that pattern. In real stars the
low-degree modes we observe have many radial nodes, so their rays dive almost through the centre and
skip only a little more than twice per turn, whatever l is.

## Opening while presenting

Everything follows reveal's "next" (space, right arrow, clicker); "back" undoes it.

| Where | Attribute | Effect |
|---|---|---|
| `<section>` | `data-stellar-open` | Next press opens every cut star on the slide. |
| `<section>` | `data-stellar-close` | ... and the press after that closes them. |
| star | `data-cut-step` | This star opens on its own press (in document order, or `="2"` like `data-fragment-index`). |
| star | `data-quarter-steps` | The quarters show their ingredients one press at a time, clockwise from the upper left (each fades in from the plain interior). The first one also opens the cut — unless `data-cut-step` comes first, which opens it plain. `="3"` numbers them like `data-fragment-index` 3, 4, 5, 6. |
| star | `data-regions-step` + `data-regions-next="rays"` | On this press the inside changes from `data-regions` to `data-regions-next` (the old one fades out, the new one in; back = the other way). Comes after the opening and quarter steps. |
| star | `data-cut-close-step` | ... and closes on a later press (after the quarter steps). |
| star | `data-cut-click` | A mouse click on the star also toggles it. |

## From JavaScript

`createStellar(container, options)` → `{ start, stop, resetCut, snapCut, openCut, closeCut, toggleCut, showQuarters, set, dispose }`
(`showQuarters(n, snap)`: only the first n quarters, clockwise from the upper left, show their ingredients)
(e.g. `set({ regions: 'burning' })`).
Option names are the attribute names in camelCase (`rotationPeriod`, `cutAngle`, …).
