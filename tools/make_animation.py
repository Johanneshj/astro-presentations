#!/usr/bin/env python3
"""
make_animation.py - turn the deck's animated objects into seamlessly looping GIFs (or WebP, APNG, MP4).

    python3 tools/make_animation.py              # asks you what to make, step by step
    python3 tools/make_animation.py --gallery    # rebuilds every animation in gallery/ (used by the README)
    python3 tools/make_animation.py --kind harmonic --l 3 --m 2 --size 600 --background transparent

Objects (--kind):
    harmonic         a pulsating spherical harmonic (red = moving in, blue = moving out)
    harmonic-rays    the same, cut open, with the acoustic rays of the mode travelling inside
    rays             only the rays, in a cross-section of the star
    star             a star (closed), with its surface texture and glow
    star-open        a star cut open, showing its radiative and convective zones
    star-rays        a star cut open, with acoustic rays travelling inside

The objects are drawn by the deck's own plugins (plugins/*.js) in a headless browser on a virtual
clock, so each frame is exact. Everything that repeats (pulsation, spin, arrows) is tuned to fit a
whole number of times into the loop. Each ray gets a whole number of bounces that add up to whole
turns (its frequency and pace nudged a little; the loop is made longer if needed). What never
repeats (boiling surfaces, the corona) is crossfaded across the seam. So the animation loops
without a jump.

Setup, once (in the repository folder):
    python3 -m venv .venv
    .venv/bin/pip install playwright pillow numpy
    .venv/bin/python -m playwright install chromium
then run it with .venv/bin/python tools/make_animation.py  (MP4 also needs ffmpeg).
"""
import argparse
import base64
import functools
import http.server
import io
import json
import math
import shutil
import subprocess
import sys
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GALLERY = ROOT / 'gallery'

try:
    import numpy as np
    from PIL import Image
    from playwright.sync_api import sync_playwright
except ImportError as e:
    sys.exit(f"Missing package ({e.name}). Install once with:\n"
             f"  python3 -m venv .venv && .venv/bin/pip install playwright pillow numpy\n"
             f"  .venv/bin/python -m playwright install chromium\n"
             f"and run with .venv/bin/python {Path(__file__).relative_to(ROOT)}")

KINDS = {
    'harmonic':      'A pulsating spherical harmonic',
    'harmonic-rays': 'A spherical harmonic cut open, with its acoustic rays inside',
    'rays':          'Acoustic rays in a cross-section of a star',
    'star':          'A star (closed)',
    'star-open':     'A star cut open, showing radiative / convective zones',
    'star-rays':     'A star cut open, with acoustic rays inside',
}

# Stars you can pick by name (any option can still be changed)
STARS = {
    'sun':        dict(color='#ffd27a', structure='sun', texture='granulation', granulation=0.6, granulationScale=20),
    'red-giant':  dict(temperature=3800, structure='red-giant', texture='granulation', granulation=0.8,
                       granulationScale=10),
    'blue':       dict(temperature=15000, structure='massive', texture='mottled', glow=1.0),
    'red-dwarf':  dict(temperature=3100, structure='dwarf', texture='granulation', granulation=0.6,
                       granulationScale=20, glow=0.6),
    'young':      dict(color='#ff8a3a', zones='convective:1', texture='mottled', tilt=22,
                       disk=True, diskInner=1.25, diskOuter=2.4),
}

STAR_NAMES = {'sun': 'The Sun', 'red-giant': 'Red giant', 'blue': 'Massive blue star',
              'red-dwarf': 'Red dwarf', 'young': 'Young star with its disk'}

# Animation speeds of the stellar interior (from plugins/stellar.js ARROW_STYLE)
LOOP_ARROW_PERIOD = 2 * math.pi / 0.8      # seconds for a convective loop arrow to turn once (arrowSpeed 1)


# ---------------------------------------------------------------------------------------------------
# Loops: tune the options so the animation repeats after `seconds`
# ---------------------------------------------------------------------------------------------------

def whole(x):
    return max(1, round(x))


def ray_setup(kind, o):
    """The rays an object draws: (degrees l, frequencies, omega, speed), or None."""
    if kind == 'rays':
        return o.get('modes', [2]), o.get('frequencies', [1]), o.get('omega', 25), o.get('speed', 1)
    if kind == 'harmonic-rays':
        return o.get('rays') or [o.get('l', 2)], o.get('rayFrequencies', [1]), o.get('rayOmega', 25), o.get('raySpeed', 1)
    if kind == 'star-rays':
        return o.get('rays', [2, 20]), o.get('rayFrequencies', [1]), o.get('rayOmega', 25), o.get('raySpeed', 1)
    return None


def plan_loop(kind, opts, seconds, rays_fit=None):
    """Returns (options, loop seconds, crossfade fraction, warm-up seconds).
    rays_fit(loop) -> True if every ray can repeat after that time without turning; the loop is
    then made longer, step by step, until they all can."""
    o = dict(opts)
    def longer(candidates):
        for T in candidates:
            if rays_fit is None or rays_fit(T):
                return T
        sys.exit('The rays do not fit any loop up to 30 s; try other degrees l or --seconds')
    if kind in ('harmonic', 'harmonic-rays'):
        rate = o.get('pulseRate', 0.5)
        n0 = whole(seconds * rate)                           # a whole number of pulsations
        T = longer([n / rate for n in range(n0, n0 + 1 + int(30 * rate))]) if kind == 'harmonic-rays' else n0 / rate
        spin = o.get('spinRate', 0.3)
        m, grid = abs(int(o.get('m', 1))), o.get('grid', False)
        # the smallest turn after which the picture looks the same
        sym = 0.0
        if grid:
            sym = math.radians(o.get('gridSpacing', 30))
        if m:
            per = 2 * math.pi / m
            sym = per if not sym else _lcm_angle(sym, per)
        o['spinRate'] = (whole(spin * T / sym) * sym / T) if (spin and sym) else (0 if sym else spin)
        if kind == 'harmonic-rays':
            o.update(cut=True, cutOpen=True, rayLoop=T)
        return o, T, 0.0, (T if kind == 'harmonic-rays' else 0.0)
    steps = [seconds + 0.5 * k for k in range(int(2 * (30 - seconds)) + 1)]
    if kind == 'rays':
        T = longer(steps)
        o['loop'] = T
        return o, T, 0.0, T
    # stars
    T = longer(steps) if kind == 'star-rays' else seconds
    period = o.get('rotationPeriod', 20)
    if period:
        o['rotationPeriod'] = math.copysign(T / whole(T / abs(period)), period)
    if kind in ('star-open', 'star-rays'):
        o.update(cut=True, cutOpen=True, cutAnimate=False)
        speed = o.get('arrowSpeed', 1)
        o['arrowSpeed'] = whole(speed * T / LOOP_ARROW_PERIOD) * LOOP_ARROW_PERIOD / T
    if kind == 'star-rays':
        o.update(regions='rays', rayLoop=T)
    elif kind == 'star-open':
        o.setdefault('regions', 'zones')
    # the boiling surface, the corona and the disk never repeat: crossfade a quarter of the loop
    return o, T, 0.25, (T if kind == 'star-rays' else 0.0)


def _lcm_angle(a, b):
    """Smallest angle that is a whole multiple of both a and b (in degrees, rounded to 0.01)."""
    da, db = round(math.degrees(a) * 100), round(math.degrees(b) * 100)
    return math.radians(da * db // math.gcd(da, db) / 100)


# ---------------------------------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------------------------------

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


class Renderer:
    """A headless browser on tools/animate/render.html, served from the repository."""

    def __enter__(self):
        handler = functools.partial(Quiet, directory=str(ROOT))
        self.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.pw = sync_playwright().start()
        self.browser = self.pw.chromium.launch(args=['--enable-unsafe-swiftshader', '--use-angle=swiftshader',
                                                     '--ignore-gpu-blocklist'])
        self.page = self.browser.new_page(device_scale_factor=1)
        self.page.on('console', lambda m: m.type in ('error', 'warning') and 'GL Driver' not in m.text
                     and print('  [browser]', m.text))
        port = self.server.server_address[1]
        self.page.goto(f'http://127.0.0.1:{port}/tools/animate/render.html')
        self.page.wait_for_function('window.rendererReady === true', timeout=60000)
        return self

    def __exit__(self, *exc):
        self.browser.close()
        self.pw.stop()
        self.server.shutdown()

    def frames(self, kind, opts, size, fps, seconds, progress=True):
        """RGBA frames (numpy, straight alpha) of one seamless loop."""
        rays = ray_setup(kind, opts)
        fits = (lambda T: self.page.evaluate('([m, f, w, s, T]) => rayLoopFits(m, f, w, s, T)', [*rays, T])) if rays else None
        o, T, fade, warm = plan_loop(kind, opts, seconds, fits)
        n = max(2, round(T * fps))
        step = 1000 * T / n                                      # exact: n frames span the loop
        nfade = round(n * fade)
        self.page.set_viewport_size({'width': size, 'height': size})
        js_kind = 'harmonic' if kind.startswith('harmonic') else 'star' if kind.startswith('star') else kind
        self.page.evaluate('([k, s, o]) => makeObject(k, s, o)', [js_kind, size, o])
        if warm:
            self.page.evaluate('ms => advance(ms)', warm * 1000)
        shots = []
        for i in range(n + nfade):
            url = self.page.evaluate('ms => frame(ms)', step if i else 0)
            shots.append(np.asarray(Image.open(io.BytesIO(base64.b64decode(url.split(',', 1)[1]))).convert('RGBA')))
            if progress:
                print(f'\r  frame {i + 1}/{n + nfade}', end='', flush=True)
        if progress:
            print()
        frames = [f.astype(np.float32) / 255 for f in shots]
        # crossfade: the frames after the loop blend into its first frames (premultiplied alpha)
        for j in range(nfade):
            w = (j + 0.5) / nfade
            a, b = frames[n + j], frames[j]
            pa, pb = a[..., :3] * a[..., 3:], b[..., :3] * b[..., 3:]
            alpha = (1 - w) * a[..., 3:] + w * b[..., 3:]
            rgb = ((1 - w) * pa + w * pb) / np.maximum(alpha, 1e-6)
            frames[j] = np.concatenate([rgb, alpha], axis=-1)
        return frames[:n], T


def on_background(frames, background):
    """Composite onto a color ('black', 'white', '#rrggbb'); 'transparent' keeps the alpha."""
    if background == 'transparent':
        return frames
    from PIL import ImageColor
    bg = np.array(ImageColor.getrgb(background), dtype=np.float32) / 255
    out = []
    for f in frames:
        a = f[..., 3:]
        rgb = f[..., :3] * a + bg * (1 - a)
        out.append(np.concatenate([rgb, np.ones_like(a)], axis=-1))
    return out


def to_uint8(frames):
    return [np.clip(f * 255 + 0.5, 0, 255).astype(np.uint8) for f in frames]


def save_gif(frames, path, fps, transparent, dither=True, colors=256):
    """One palette for the whole animation (no flicker); transparent pixels get the last palette entry."""
    rgb = [f[..., :3] for f in frames]
    sample = np.concatenate(rgb[::max(1, len(rgb) // 12)], axis=0)
    colors = max(2, min(256, colors))
    clear = colors - 1                                           # palette index of 'transparent'
    palette = Image.fromarray(sample).quantize(colors=clear if transparent else colors, method=Image.Quantize.MEDIANCUT)
    images = []
    for f, c in zip(frames, rgb):
        img = Image.fromarray(c).quantize(palette=palette,
                                          dither=Image.Dither.FLOYDSTEINBERG if dither else Image.Dither.NONE)
        if transparent:
            idx = np.array(img)
            idx[f[..., 3] < 128] = clear
            img = Image.frombytes('P', idx.shape[::-1], idx.tobytes())
            img.putpalette(palette.getpalette()[:3 * clear] + [0, 0, 0])
        images.append(img)
    extra = dict(transparency=clear, disposal=2) if transparent else {}
    images[0].save(path, save_all=True, append_images=images[1:], duration=round(1000 / fps), loop=0,
                   optimize=False, **extra)


def save(frames, path, fps, background, dither=True, colors=256):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    ext = path.suffix.lower()
    pics = to_uint8(on_background(frames, background))
    transparent = background == 'transparent'
    if ext == '.gif':
        save_gif(pics, path, fps, transparent, dither, colors)
    elif ext == '.webp':
        imgs = [Image.fromarray(p) for p in pics]
        imgs[0].save(path, save_all=True, append_images=imgs[1:], duration=round(1000 / fps), loop=0,
                     quality=90, method=6)
    elif ext == '.png':                                         # animated PNG
        imgs = [Image.fromarray(p) for p in pics]
        imgs[0].save(path, save_all=True, append_images=imgs[1:], duration=round(1000 / fps), loop=0)
    elif ext == '.mp4':
        if not shutil.which('ffmpeg'):
            sys.exit('MP4 needs ffmpeg (https://ffmpeg.org)')
        h, w = pics[0].shape[:2]
        if transparent:
            pics = to_uint8(on_background(frames, 'black'))     # MP4 has no transparency
        cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', f'{w}x{h}',
               '-r', str(fps), '-i', '-', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '16', str(path)]
        subprocess.run(cmd, input=b''.join(p.tobytes() for p in pics), check=True)
    else:
        sys.exit(f'Unknown format "{ext}" (use .gif, .webp, .png or .mp4)')
    print(f'  saved {path.relative_to(ROOT) if path.is_relative_to(ROOT) else path}'
          f'  ({path.stat().st_size / 1e6:.1f} MB)')


# ---------------------------------------------------------------------------------------------------
# What to make: interactive questions, or command-line options
# ---------------------------------------------------------------------------------------------------

def ask(question, default=None, cast=str, choices=None):
    hint = f' [{default}]' if default is not None else ''
    while True:
        answer = input(f'{question}{hint}: ').strip()
        if not answer and default is not None:
            answer = str(default)
        if choices and answer not in choices:
            print(f'  please answer one of: {", ".join(choices)}')
            continue
        try:
            return cast(answer)
        except ValueError:
            print('  that does not look right, try again')


def yes(question, default=True):
    return ask(question + ' (y/n)', 'y' if default else 'n', choices=['y', 'n', 'yes', 'no']).startswith('y')


def color(text):
    """A color the browser understands: a name or #rrggbb (checked, so a typo is asked again)."""
    from PIL import ImageColor
    ImageColor.getrgb(text)                          # raises ValueError if it isn't a color
    return text


def int_list(text):
    return [int(v) for v in text.replace(',', ' ').split()]


def interactive():
    print('\nWhat would you like to make?')
    names = list(KINDS)
    for i, k in enumerate(names, 1):
        print(f'  {i}. {KINDS[k]}')
    kind = names[ask('Number', 1, int, [str(i) for i in range(1, len(names) + 1)]) - 1]
    o = {}
    if kind in ('harmonic', 'harmonic-rays'):
        print('\nThe mode: degree l (number of nodal lines) and azimuthal order m (-l <= m <= l).')
        o['l'] = ask('l', 3, int)
        o['m'] = ask('m', min(2, o['l']), int)
        o['pulseAmplitude'] = ask('Pulsation amplitude (fraction of the radius)', 0.12, float)
        o['pulseRate'] = ask('Pulsations per second', 0.5, float)
        o['spinRate'] = ask('Rotation, radians per second (0 = none)', 0.3, float)
        if yes('Latitude / longitude grid?'):
            o['grid'] = True
            o['gridSpacing'] = ask('Grid spacing in degrees', 30, int)
        print('\nColors: 1. red / white / blue (red = moving in, blue = moving out)   2. your own three')
        if ask('Number', 1, int, ['1', '2']) == 2:
            print('Any color name (red, gold, ...) or #rrggbb.')
            o['colors'] = [ask('Moving in', '#ff1a1a', color), ask('Nodes (not moving)', '#ffffff', color),
                           ask('Moving out', '#1a4dff', color)]
        if kind == 'harmonic-rays':
            rays = ask('Degrees l of the rays inside (empty = this mode)', '', str)
            if rays:
                o['rays'] = int_list(rays)
            o['cutAngle'] = ask('Opening of the cut, degrees', 90, float)
    elif kind == 'rays':
        o['modes'] = int_list(ask('Degrees l of the rays, e.g. "1, 5, 20" (repeat one, "1 1 1", to spread it)', '1, 5, 20'))
        o['trail'] = ask('Trail length (fraction of a lap)', 0.8, float)
        o['width'] = ask('Line width (1 = default)', 1.5, float)
    else:
        print('\nStars: ' + ', '.join(STARS) + '  (or "custom")')
        name = ask('Which star', 'sun', choices=list(STARS) + ['custom'])
        if name == 'custom':
            o['temperature'] = ask('Surface temperature (K)', 6000, int)
            o['texture'] = ask('Surface texture', 'mottled',
                               choices=['none', 'granulation', 'spots', 'both', 'mottled', 'bands', 'network'])
            if kind != 'star':
                o['zones'] = ask('Zones from the centre out, e.g. "radiative:0.7, convective:1"',
                                 'radiative:0.7, convective:1')
        else:
            o.update(STARS[name])
        o['rotationPeriod'] = ask('Rotation period in seconds (0 = none)', 8, float)
        if kind == 'star-rays':
            o['rays'] = int_list(ask('Degrees l of the rays, e.g. "1, 5, 20"', '1, 5, 20'))
    print('\nThe animation')
    seconds = ask('Loop length, seconds (it is adjusted to close the loop)', 8 if kind.startswith('star') else 6, float)
    size = ask('Size in pixels (width = height)', 480, int)
    fps = ask('Frames per second (GIF: 10, 20, 25 or 50 keep their timing)', 20, int)
    default_bg = 'transparent' if kind in ('harmonic', 'harmonic-rays', 'rays') else 'black'
    background = ask('Background: transparent, black, white or #rrggbb', default_bg)
    fmt = ask('Format', 'gif', choices=['gif', 'webp', 'png', 'mp4'])
    out = ask('File name', f'{kind}.{fmt}')
    return [dict(kind=kind, options=o, seconds=seconds, size=size, fps=fps, background=background, out=out)]


# The README gallery: 5 of each
def gallery_jobs():
    jobs = []
    def add(name, kind, options, seconds, background, label='', size=280, fps=20):
        jobs.append(dict(kind=kind, options=options, seconds=seconds, size=size, fps=fps, label=label,
                         background=background, out=str(GALLERY / f'{name}.gif'), colors=128))
    harm = dict(pulseAmplitude=0.12, grid=True, gridSpacing=30, gridOpacity=0.35)
    for l, m in [(1, 1), (2, 0), (3, 2), (5, 3), (12, 6)]:
        add(f'harmonic_l{l}_m{m}', 'harmonic', dict(harm, l=l, m=m), 6, 'transparent', f'ℓ = {l}, m = {m}')
    for name, modes, label in [('l1', [1], 'ℓ = 1'), ('l2', [2], 'ℓ = 2'), ('l20', [20], 'ℓ = 20'),
                               ('dipoles', [1, 1, 1], 'three ℓ = 1'), ('l1_5_20', [1, 5, 20], 'ℓ = 1, 5, 20')]:
        add(f'rays_{name}', 'rays', dict(modes=modes, width=1.6), 6, 'transparent', label)
    for l, m in [(1, 0), (2, 1), (3, 3), (6, 2), (20, 10)]:
        add(f'harmonic_rays_l{l}_m{m}', 'harmonic-rays',
            dict(harm, l=l, m=m, gridOpacity=0.25, rayWidth=1.4, spinRate=0.2), 6, 'transparent', f'ℓ = {l}, m = {m}')
    star = dict(radius=0.62, glowSize=0.55, rotationPeriod=6)
    for name in STARS:
        size = dict(star, radius=0.36) if STARS[name].get('disk') else star     # room for the disk
        add(f'star_{name}', 'star', dict(size, **STARS[name]), 6, 'black')
        add(f'star_{name}_open', 'star-open', dict(size, **STARS[name]), 6, 'black')
    for name, modes in [('sun', [1, 5, 20]), ('red-giant', [2, 20]), ('blue', [1, 2, 3]),
                        ('red-dwarf', [3]), ('young', [1, 1, 1])]:
        size = dict(star, radius=0.36) if STARS[name].get('disk') else star
        add(f'star_{name}_rays', 'star-rays', dict(size, **STARS[name], rays=modes, rayWidth=1.4), 6, 'black')
    return jobs


GALLERY_SECTIONS = [
    ('harmonic_l', '🌐 Spherical harmonics', 'A star ringing in one mode (ℓ, m). Red: the surface moving in, '
     'blue: moving out (like a Doppler shift). Transparent background.'),
    ('rays_', '〰️ Acoustic rays', 'Sound waves travelling inside a star, drawn in a cross-section. Low degree ℓ '
     'dives deep, high ℓ stays near the surface; the dotted circle is where each ray turns back.'),
    ('harmonic_rays_', '🌐〰️ Harmonics with their rays', 'The pulsating star cut open, with the rays of its '
     'mode inside.'),
    ('star_', '⭐ Stars', 'Closed, and cut open: radiative zones (wiggly arrows: energy carried by light) and '
     'convective zones (loops: energy carried by boiling gas).'),
]


def write_gallery_page(jobs):
    """gallery/README.md: every gallery animation, with how to make it again."""
    names = [Path(j['out']).stem for j in jobs]
    labels = {Path(j['out']).stem: j.get('label') or Path(j['out']).stem for j in jobs}
    lines = ['# Gallery', '',
             'Every animation here is made by [`tools/make_animation.py`](../tools/make_animation.py) and loops '
             'seamlessly. Make one again, at any size or as WebP / MP4:', '',
             '```bash', '.venv/bin/python tools/make_animation.py --gallery --only star_sun_open', '```', '',
             'or answer a few questions to make your own: `.venv/bin/python tools/make_animation.py`.', '']
    stars = [n for n in names if n.startswith('star_')]
    for prefix, title, text in GALLERY_SECTIONS:
        group = stars if prefix == 'star_' else [n for n in names if n.startswith(prefix)]
        if not group:
            continue
        lines += [f'## {title}', '', text, '']
        if prefix == 'star_':                        # one row per star: closed, open, with rays
            lines += ['| Star | Closed | Open | With rays |', '|---|:---:|:---:|:---:|']
            for star in STARS:
                cells = [f'<img src="star_{star}{v}.gif" width="200">' if f'star_{star}{v}' in names else ''
                         for v in ('', '_open', '_rays')]
                lines.append(f'| **{STAR_NAMES.get(star, star)}**<br><sub>`--star {star}`</sub> | ' + ' | '.join(cells) + ' |')
        else:
            lines.append('| ' + ' | '.join(labels[n] for n in group) + ' |')
            lines.append('|' + ':---:|' * len(group))
            lines.append('| ' + ' | '.join(f'<img src="{n}.gif" width="160" alt="{labels[n]}">' for n in group) + ' |')
            lines.append('| ' + ' | '.join(f'<sub>`{n}`</sub>' for n in group) + ' |')
        lines.append('')
    (GALLERY / 'README.md').write_text('\n'.join(lines))
    print('  wrote gallery/README.md')


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--gallery', action='store_true', help='rebuild every animation in gallery/')
    p.add_argument('--only', help='with --gallery: only the names containing this text')
    p.add_argument('--kind', choices=KINDS)
    p.add_argument('--l', type=int)
    p.add_argument('--m', type=int)
    p.add_argument('--star', choices=STARS, help='a named star (for the star kinds)')
    p.add_argument('--rays', help='degrees l of the rays, e.g. "1,5,20"')
    p.add_argument('--options', default='{}', help='any other option of the plugin, as JSON, e.g. \'{"grid": true}\'')
    p.add_argument('--seconds', type=float, default=6, help='loop length (adjusted to close the loop)')
    p.add_argument('--size', type=int, default=480, help='width = height in pixels')
    p.add_argument('--fps', type=int, default=20)
    p.add_argument('--background', default=None, help='transparent, black, white or #rrggbb')
    p.add_argument('--out', help='output file (.gif, .webp, .png = animated PNG, .mp4)')
    p.add_argument('--colors', type=int, default=256, help='GIF colors, 2-256 (fewer = smaller file)')
    a = p.parse_args()

    if a.gallery:
        jobs = [j for j in gallery_jobs() if not a.only or a.only in Path(j['out']).stem]
    elif a.kind:
        o = dict(STARS[a.star]) if a.star else {}
        if a.l is not None:
            o['l'] = a.l
        if a.m is not None:
            o['m'] = a.m
        if a.rays:
            o['modes' if a.kind == 'rays' else 'rays'] = int_list(a.rays)
        o.update(json.loads(a.options))
        background = a.background or ('transparent' if a.kind in ('harmonic', 'harmonic-rays', 'rays') else 'black')
        jobs = [dict(kind=a.kind, options=o, seconds=a.seconds, size=a.size, fps=a.fps,
                     background=background, out=a.out or f'{a.kind}.gif', colors=a.colors)]
    else:
        jobs = interactive()

    if a.gallery and not a.only:
        GALLERY.mkdir(exist_ok=True)
        write_gallery_page(jobs)
    with Renderer() as r:
        for j in jobs:
            print(f"{Path(j['out']).name}: {KINDS[j['kind']]}")
            frames, T = r.frames(j['kind'], j['options'], j['size'], j['fps'], j['seconds'])
            print(f'  loop {T:.2f} s, {len(frames)} frames')
            save(frames, j['out'], j['fps'], j['background'], colors=j.get('colors', 256))


if __name__ == '__main__':
    main()
