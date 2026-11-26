# Theme, starfield and layout helpers

## Theme (`theme/astro.scss` → `theme/astro.css`)

The SCSS file is the source; the page loads the generated CSS. After editing the SCSS:

```bash
npx sass theme/astro.scss theme/astro.css --no-source-map
```

(`npx` downloads Sass the first time; or `npm install` once and then `npm run theme`.)
The reveal.js theme template it builds on is in `vendor/reveal/theme-template/`.

Colors and fonts are set at the top (`$background-color`, `$main-color`, `$heading-color`, …).
Plugin colors that the CSS uses live in `:root` (`--astro-accent`, `--astro-muted`, …).

## Starfield (`theme/starfield.js`)

A reveal plugin (`StarfieldPlugin`) that draws a 3D field of stars behind the slides. Left/right
turns the camera, up/down flies forward/backward. All numbers are in `SETTINGS` at the top
(number of stars, step sizes, smoothing time, glow).

`verticalTransition: 'zoom'` in `Reveal.initialize` makes the slides themselves zoom on up/down,
along with the camera's flight (left/right keeps `transition`). Any reveal transition name works;
a slide's own `data-transition` overrides it.

### A nebula in the starfield

```html
<section data-nebula data-nebula-fill="1.25"></section>
```

Puts a glowing gas cloud (a star-forming region, after the Rosette nebula) into the 3D starfield,
straight ahead of the camera at this slide. It is part of the scene, so it is faint and far away on
earlier slides, and the camera's flight towards it makes the zoom feel real. Best on a vertical
(child) slide, so the up/down flight carries you into it. On the next slide the camera is "inside"
and only a soft reddish glow is left.

| Attribute | Default | Meaning |
|---|---|---|
| `data-nebula-fill` | `1.3` | Its size on its own slide, as a fraction of the screen height (> 1 overfills the screen). |
| `data-nebula-distance` | `220` | How far away it sits in the starfield (bigger = it grows more slowly as you approach). |
| `data-nebula-seed` | `1` | A different number gives a differently shaped cloud. |
| `data-nebula-speed` | `1` | How fast the gas moves. It flows like a gas: an overall slow rotation plus random swirls that come and go (wisps and dark smoke swirl faster than the main cloud). 0 = still, 2 = twice as fast. |

The picture is painted once while the deck loads (resolution `SETTINGS.nebulaPixels`) and drawn with WebGL on its
own canvas under the stars, at half resolution (`SETTINGS.nebulaResolution`). The flow (the rotation and the
swirl field, the curl of a slowly changing noise field) is in `NEBULA_FRAGMENT` in `theme/starfield.js`:
the numbers in `main()` set the rotation rates and the swirl strength of the gas and the wisps.

## Layout classes

| Class | Use |
|---|---|
| `row` | Items side by side, centered (`style="gap: 10px"` to change spacing). |
| `column` | Items stacked, centered. |
| `corners` | Four children in the four corners, a fifth (e.g. a heading) in the middle. Height: `style="--corners-height: 600px"`. |
| `caption` | Small grey caption text. |
| `todo` | Dashed placeholder box for unfinished slides. |
| `twinkle` | On SVG circles: gentle twinkling. |
| `fragment custom draw-line` + `pathLength="1"` | On an SVG polyline/path: the line draws itself on "next". |

## Slide size

`width` / `height` in `Reveal.initialize` (index.html). The template uses 1280 × 720 (16:9);
all sizes in `data-width`, `data-radius` … are in these slide pixels and scale with the screen.

## Lowercase letters in titles

Titles (and the names under the stars) are set in capitals, so a δ typed in a title shows as Δ.
Wrap it to keep it as written: `<h2><span class="keep-case">&delta;</span>-Scuti star</h2>`
(`&delta;` is the same as pasting δ). `$\delta$` only works with reveal's math plugin, which this deck doesn't load.
League Gothic has no Greek letters; in titles they come from Fira Sans Extra Condensed (weight 500, its Greek
letters only, in `theme/fonts/`, so it works offline), which has the same narrow shape.
