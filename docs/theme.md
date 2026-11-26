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
all sizes in `data-width`, `data-size` … are in these slide pixels and scale with the screen.
