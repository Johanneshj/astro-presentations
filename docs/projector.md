# Projector colours (`plugins/projectorPlugin.js`)

A projector shows less contrast than a laptop screen and clips the brightest tones. Near-white details,
such as a hot star's mottling or the grid lines on a spherical harmonic, all become the same white, and
colours look washed out. Projector mode puts one colour adjustment on the whole deck, starfield included:

| Setting | Default | What it does |
|---|---|---|
| Brightness | `0.85` | Below 1 pulls the near-whites back under the point where the projector clips them, so they keep their detail. |
| Saturation | `1.3` | Above 1 gives back the colour the projector washes out. |
| Contrast | `1.05` | A little more (or less) spread between dark and light. |

## Keys

| Key | |
|---|---|
| `D` | Projector mode on / off. |
| `Shift+D` | A small panel with sliders. Tune it in the room, looking at the projector. |
| `?projector=1` / `?projector=0` | In the URL: on / off for this page. |

Whatever you set is remembered in that browser (on the computer you present from), so you tune it
once and it stays. The panel's Reset goes back to the starting values. They are set in
`Reveal.initialize` in index.html:

```js
projector: { brightness: 0.85, saturation: 1.3, contrast: 1.05 },
```

Add `on: true` to start with projector mode on (index_final.html does this). The remembered
settings are kept per browser and per address (the same `localhost:8766`), so they survive a
restart; a different browser, port or computer starts again from these values. Once the room's
values are known, write them here so they never depend on the browser.

## Tuning in the room

1. Go to a slide with bright details, e.g. the four stars opened (the blue star's mottling) or the
   spherical harmonic (white grid lines).
2. Press `Shift+D` and lower Brightness until the details show on the projector.
3. Raise Saturation until the colours look right.
4. Close the panel (`Shift+D`). `D` turns the adjustment off and on, to compare.

## Sharpness

Softness on a projector usually comes from the resolution the laptop sends it, not from the slides.
In System Settings → Displays, pick the projector and choose its own (native) resolution, often
1920 × 1080 or 1920 × 1200. Use "Extend", not "Mirror", when the speaker view is on the laptop. A
mirrored display uses one resolution for both screens, and the projector then scales the picture.
