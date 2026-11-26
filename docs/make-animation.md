# Making GIFs: `tools/make_animation.py`

Renders the deck's objects into animations that **loop without a jump**, to use outside the slides.
The [gallery](../gallery/README.md) shows what it makes.

## Setup (once)

```bash
python3 -m venv .venv
.venv/bin/pip install playwright pillow numpy
.venv/bin/python -m playwright install chromium
```

MP4 output also needs [ffmpeg](https://ffmpeg.org).

## Three ways to run it

```bash
.venv/bin/python tools/make_animation.py                          # asks you, step by step
.venv/bin/python tools/make_animation.py --kind star-open --star blue --size 600 --out blue.gif
.venv/bin/python tools/make_animation.py --gallery                # rebuilds gallery/ (--only sun: just those)
```

## Options

| Option | Default | |
|---|---|---|
| `--kind` | | `harmonic`, `harmonic-rays`, `rays`, `star`, `star-open`, `star-rays` |
| `--l`, `--m` | | The mode, for `harmonic` and `harmonic-rays` |
| `--star` | | A ready-made star: `sun`, `red-giant`, `blue`, `red-dwarf`, `young` |
| `--rays` | | Degrees ℓ of the rays, e.g. `"1,5,20"`. Repeat one (`"1,1,1"`) to spread copies round the star. |
| `--size` | `480` | Width = height, in pixels |
| `--seconds` | `6` | Loop length; nudged so that everything fits a whole number of times |
| `--fps` | `20` | Frames per second. GIF timing is in steps of 10 ms, so 10, 20, 25 or 50 are exact. |
| `--background` | `transparent` for harmonics and rays, `black` for stars | `transparent`, `black`, `white`, `#rrggbb` |
| `--colors` | `256` | GIF only: fewer colours give a smaller file |
| `--out` | `<kind>.gif` | `.gif`, `.webp`, `.png` (animated PNG) or `.mp4`, picked from the file name |
| `--options` | `{}` | Any other option of the plugin, as JSON, e.g. `'{"grid": true, "pulseAmplitude": 0.2}'` |

**Harmonic colours:** red / white / blue by default (red = moving in, white = the nodes, blue =
moving out). The questions let you pick your own three. On the command line:
`--options '{"colors": ["purple", "white", "#2a9d8f"]}'` (moving in, nodes, moving out).

The `--options` names are the plugin's own:
- harmonics: see the JavaScript options in [pulsating-star.md](pulsating-star.md);
- stars: see [stellar.md](stellar.md);
- `rays`: `modes`, `trail`, `width`, `colors`, `discColor`.

## Transparency

- **GIF** pixels are either fully see-through or solid. That suits the harmonics and rays, which
  have sharp edges. A star's soft glow would get a jagged fringe, so stars default to black;
  `--background white` also works.
- **WebP and animated PNG** keep soft, true transparency for everything:
  `--out star.webp --background transparent`.
- **MP4** has no transparency; it uses black.

## How the loops close

The objects run on a virtual clock in a headless browser, so every frame is exact.
- **Things that repeat:** pulsation, spin and the interior arrows. Their speeds are nudged so
  they fit a whole number of times into the loop.
- **The rays:** a ray only comes back to its start after a whole number of bounces that add up to
  whole turns round the star. Each ray's frequency (by a few percent) and pace are nudged so that
  happens exactly within the loop. The rays never turn as a whole. If they can't fit, the loop is
  made longer (an ℓ = 1 ray needs about 10 s).
- **Things that never repeat:** a star's boiling surface, its corona and its disk. These are
  crossfaded over the last quarter of the loop.
