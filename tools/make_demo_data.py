"""
Make SYNTHETIC demo light curves for the template presentation, so every slide works before the
real data is in place. They look roughly right but are not real measurements; replace them.

    python3 tools/make_demo_data.py

Writes data/demo/{sun,spb,dsct,cepheid}.txt: two columns, time in days and brightness
(ppm for the Sun, mmag-like units for the others). Only the Python standard library is needed.
"""
import math
import os
import random

OUT = os.path.join(os.path.dirname(__file__), '..', 'data', 'demo')
os.makedirs(OUT, exist_ok=True)
random.seed(42)
TAU = 2 * math.pi


def write(name, header, rows):
    path = os.path.join(OUT, name)
    with open(path, 'w') as f:
        f.write('# SYNTHETIC DEMO DATA - not a real measurement. Replace with real data.\n')
        for line in header:
            f.write(f'# {line}\n')
        f.write('# time_d  flux\n')
        for t, y in rows:
            f.write(f'{t:.6f} {y:.4f}\n')
    print(f'wrote {path} ({len(rows)} rows)')


def sun():
    """10 days at 60 s cadence. p modes around 3.1 mHz spaced by ~135 uHz (l = 0 and 1),
    with slowly wandering phases (stochastic excitation), plus granulation and white noise."""
    dt = 60.0
    n = int(10 * 86400 / dt)
    numax, dnu, width = 3100e-6, 135e-6, 450e-6
    modes = []
    for k in range(-8, 9):
        for l, shift in ((0, 0.0), (1, 0.5)):
            nu = numax + (k + shift) * dnu
            amp = 2.5 * math.exp(-((nu - numax) / width) ** 2) * (1.0 if l == 0 else 1.3)
            modes.append([nu, amp, random.uniform(0, TAU)])
    gran = 0.0
    rows = []
    for i in range(n):
        t = i * dt
        y = 0.0
        for m in modes:
            m[2] += random.gauss(0, 0.004)          # phase random walk
            y += m[1] * math.sin(TAU * m[0] * t + m[2])
        gran = 0.995 * gran + random.gauss(0, 1.1)  # red noise (granulation)
        y += gran + random.gauss(0, 1.5)
        rows.append((t / 86400, y))
    write('sun.txt', ['Sun-like: 5-minute oscillations, 60 s cadence, 10 days, flux in ppm'], rows)


def spb():
    """60 days at 30 min cadence with a gap in the middle. A few g modes, periods ~1 day."""
    rows = []
    modes = [(1 / 0.91, 6.0), (1 / 1.12, 4.0), (1 / 1.37, 3.0), (1 / 0.78, 2.0)]   # (cycles/day, mmag)
    phases = [random.uniform(0, TAU) for _ in modes]
    t = 0.0
    while t < 60:
        if not (28 < t < 31):
            y = sum(a * math.sin(TAU * f * t + p) for (f, a), p in zip(modes, phases))
            rows.append((t, y + random.gauss(0, 0.6)))
        t += 1 / 48
    write('spb.txt', ['SPB-like: g modes with periods near 1 day, 30 min cadence, mmag'], rows)


def dsct():
    """27 days at 2 min cadence with a gap. p modes at 10-35 cycles per day."""
    rows = []
    modes = [(12.7, 8.0), (16.9, 5.0), (20.3, 3.5), (24.1, 2.0), (29.6, 1.5), (13.9, 1.2), (33.2, 0.8)]
    phases = [random.uniform(0, TAU) for _ in modes]
    t = 0.0
    while t < 27:
        if not (13 < t < 14):
            y = sum(a * math.sin(TAU * f * t + p) for (f, a), p in zip(modes, phases))
            rows.append((t, y + random.gauss(0, 0.5)))
        t += 2 / 1440
    write('dsct.txt', ['delta Scuti-like: p modes at 10-35 c/d, 2 min cadence, mmag'], rows)


def cepheid():
    """60 days at 30 min cadence: a sawtooth-like pulsation (fast rise, slow decline), P = 5.37 d."""
    P = 5.366
    harmonics = [(1, 300.0, 0.0), (2, 110.0, 0.9), (3, 50.0, 1.9), (4, 25.0, 2.9), (5, 12.0, 3.8)]
    rows = []
    t = 0.0
    while t < 60:
        y = sum(a * math.sin(TAU * k * t / P + ph) for k, a, ph in harmonics)
        rows.append((t, y + random.gauss(0, 4)))
        t += 1 / 48
    write('cepheid.txt', ['Cepheid-like: radial pulsation with P = 5.37 d, 30 min cadence, mmag'], rows)


if __name__ == '__main__':
    sun()
    spb()
    dsct()
    cepheid()
