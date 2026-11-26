// plugins/guitar.js
// A minimalistic 2D guitar with vibrating, clickable strings, and a cartoon "wiggle" of the whole
// instrument in toy vibration modes. Geometry lives in guitarGeometry.js, the string physics in
// stringModes.js. As a slide element: <div class="guitar" data-...>, see guitarPlugin.js / docs/guitar.md.

import {
  X_BRIDGE, X_NUT, X_END, X_FRETBOARD_END, HEADSTOCK_LENGTH, NUM_FRETS, BODY_END,
  NUT_HALF_WIDTH, BOARD_END_HALF_WIDTH, SOUND_HOLE, OUTLINE, TUNING, VIEW,
  fretDistance, fretboardHalfWidth, stringEnds,
} from './guitarGeometry.js';
import { modeFrequency, pluckAmplitudes, modeAmplitudesAt } from './stringModes.js';
import { pixelRatio } from './lib/revealHelpers.js';

/** Smooth closed curve through the points P (uniform Catmull-Rom, written as Bezier segments). */
function smoothClosedPath(ctx, P) {
  const n = P.length;
  ctx.moveTo(P[0][0], P[0][1]);
  for (let i = 0; i < n; i++) {
    const p0 = P[(i - 1 + n) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n];
    ctx.bezierCurveTo(
      p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6,
      p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6,
      p2[0], p2[1]
    );
  }
  ctx.closePath();
}

const N_MAX = 60;      // most modes kept per string
const M = 200;         // samples along a string when drawing it

// ---------- Toy body modes ----------
// Not a model of a real guitar, but each one is a kind of motion real guitars do have.
//   freq     wiggles per second on screen
//   size     how far it moves (mm at amount = 1)
//   patches  colored patches on the top plate: [x, y, radius, sign]; red = moving towards you,
//            blue = away (same colors as the spherical-harmonic stars, so the link is easy to make)
export const WIGGLE_MODES = {
  // The top plate breathes in and out (the "monopole", the mode that pumps air through the hole)
  breathe: { freq: 1.1, size: 0.05, patches: [[150, 0, 150, 1]] },
  // One side of the lower bout up while the other goes down ("cross dipole")
  cross:   { freq: 1.6, size: 10,   patches: [[150, 85, 100, 1], [150, -85, 100, -1]] },
  // Lower and upper bout opposite ("long dipole")
  long:    { freq: 1.9, size: 0.04, patches: [[140, 0, 130, 1], [405, 0, 105, -1]] },
  // The whole instrument flexes like a free bar: ends one way, middle the other
  bend:    { freq: 0.8, size: 12,   patches: [] },
  // The neck swings like a diving board
  neck:    { freq: 0.6, size: 22,   patches: [] },
};

// Smooth weight that is 1 on the body and fades to 0 just past the neck join
function bodyWeight(x) {
  const t = Math.min(1, Math.max(0, (x - BODY_END) / 30));
  return 1 - t * t * (3 - 2 * t);
}

export function createGuitar(container, options = {}) {
  const opts = {
    width: 800, height: 373,         // layout size in CSS pixels
    renderScale: 1,                  // render-resolution multiplier (for reveal's slide scale)
    bodyColor: '#8a5a2b',
    edgeColor: '#5a3a1a',
    neckColor: '#3b2a1a',
    headColor: '#2b1d12',
    holeColor: '#1a1008',
    stringColor: '#e6e6e6',
    fretColor: '#c9c2b4',
    nutColor: '#e8e0cf',
    holdColor: '#ffd27a',            // colour of a string while you hold it
    strings: true,                   // false = a guitar without strings (and without the nut and pegs' strings)

    slowdown: 100,        // slow motion: displayed frequency = real frequency / slowdown
    maxDisplayHz: 20,     // modes that would flicker faster than this on screen are left out
    decayTime: 5,         // seconds (on screen) for the fundamental to fall to 1/e of its amplitude
    decaySlope: 0.5,      // how much faster the overtones decay (0 = all modes decay equally)
    stiffness: 0,         // inharmonicity B: 0 = perfectly harmonic; real strings ~ 0.0001-0.001
    pluckHeight: 8,       // pluck height in mm for a plain click
    maxPull: 18,          // largest sideways pull in mm when dragging a string
    interactive: true,    // false = the strings can only be plucked from code

    wiggle: ['breathe', 'bend'],     // body modes used by wiggle(); names from WIGGLE_MODES
    wiggleAmount: 1,                 // overall size of the wiggle
    wiggleSpeed: 1,                  // overall speed of the wiggle
    wiggleRamp: 0.8,                 // seconds to fade the wiggle in / out
    wigglePatches: true,             // show the red / blue patches on the top plate
    wiggleColors: ['#1a4dff', '#ff1a1a'],   // [moving away, moving towards you]
    wiggleOpacity: 0.7,
    ...options
  };

  // Warn about misspelled option names
  const known = new Set(Object.keys(opts));
  for (const key of Object.keys(options)) {
    if (!known.has(key)) console.warn(`createGuitar: unknown option "${key}"`);
  }

  // Reserve the layout space and create the canvas
  container.style.width = opts.width + 'px';
  container.style.height = opts.height + 'px';
  const canvas = document.createElement('canvas');
  canvas.style.width = opts.width + 'px';
  canvas.style.height = opts.height + 'px';
  canvas.style.touchAction = 'none';              // the browser must not scroll or zoom while you drag
  canvas.style.userSelect = 'none';
  canvas.setAttribute('data-prevent-swipe', '');  // reveal.js: do not change slide on a touch swipe here
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  let ratio = 1;
  function resize() {
    ratio = pixelRatio(opts.renderScale, opts.width, opts.height);
    canvas.width = Math.round(opts.width * ratio);
    canvas.height = Math.round(opts.height * ratio);
  }

  // ---------- View transform: model (mm, y up) <-> CSS pixels ----------
  //   pixel_x = k * (X - cx) + width / 2        pixel_y = height / 2 - k * Y

  function getView() {
    const k = Math.min(opts.width / (VIEW.xMax - VIEW.xMin), opts.height / (VIEW.yMax - VIEW.yMin));
    const cx = (VIEW.xMin + VIEW.xMax) / 2;
    return { k, cx };
  }

  /** Pointer event -> model coordinates. Reveal scales the slide with CSS, so we rescale by
   *  the canvas' on-screen size relative to its layout size. */
  function toModel(e) {
    const rect = canvas.getBoundingClientRect();
    const px = (e.clientX - rect.left) * (opts.width / rect.width);
    const py = (e.clientY - rect.top) * (opts.height / rect.height);
    const { k, cx } = getView();
    return { X: cx + (px - opts.width / 2) / k, Y: (opts.height / 2 - py) / k };
  }

  // ---------- String state ----------

  // sin(n*pi*s) at the M+1 sample points, computed once: sinTable[n * (M + 1) + j]
  const sinTable = new Float32Array((N_MAX + 1) * (M + 1));
  for (let n = 1; n <= N_MAX; n++) {
    for (let j = 0; j <= M; j++) sinTable[n * (M + 1) + j] = Math.sin(n * Math.PI * j / M);
  }

  const strings = Array.from({ length: 6 }, () => ({
    active: false,                   // is this string currently vibrating?
    t0: 0,                           // moment of the pluck (seconds, performance clock)
    t: 0,                            // seconds since the pluck (negative while waiting for a strum delay)
    nModes: 0,
    b: null,                         // mode amplitudes at t = 0
    a: new Float64Array(N_MAX + 1),  // mode amplitudes right now
  }));

  let held = null;                   // while dragging: { i, xFrac, h, dragged, startX, startY }
  let dirty = true;                  // does the picture need redrawing?

  /** Release string i (0 = lowest) from a triangle of height h (mm, signed) with its peak at a
   *  fraction xFrac of the string, measured from the bridge. */
  function pluck(i, xFrac = 0.3, height = opts.pluckHeight, delay = 0) {
    if (!(i >= 0 && i <= 5)) throw new Error('pluck: string index must be 0..5 (0 = lowest string)');
    const st = strings[i];
    const f1 = TUNING[i] / opts.slowdown;                 // displayed fundamental frequency (Hz)
    let n = 1;                                            // keep the modes that stay below maxDisplayHz
    while (n < N_MAX && modeFrequency(n + 1, f1, opts.stiffness) <= opts.maxDisplayHz) n++;
    st.nModes = n;
    st.b = pluckAmplitudes(n, xFrac, height);
    st.t0 = performance.now() / 1000 + delay;
    st.t = -delay;
    st.active = true;
    dirty = true;
  }

  /** Pluck all six strings one after another, like a strum. */
  function strum(xFrac = 0.3, height = opts.pluckHeight, gap = 0.08) {
    for (let i = 0; i < 6; i++) pluck(i, xFrac, height, i * gap);
  }

  // ---------- Body wiggle ----------
  // level fades between 0 (still) and 1 (full wiggle); phase advances with time.

  const wiggleState = { target: 0, level: 0, time: 0 };
  let modeAmps = [];                 // [{ mode, a }] for the current frame, a = signed amplitude

  function wiggle(modes) {
    if (modes) opts.wiggle = Array.isArray(modes) ? modes : String(modes).split(',').map(s => s.trim());
    for (const name of opts.wiggle) {
      if (!(name in WIGGLE_MODES)) console.warn(`createGuitar: unknown wiggle mode "${name}" (use ${Object.keys(WIGGLE_MODES).join(', ')})`);
    }
    wiggleState.target = 1;
    dirty = true;
  }
  function stopWiggle() { wiggleState.target = 0; }
  function snapWiggle(on) {
    wiggleState.target = wiggleState.level = on ? 1 : 0;
    if (on) wiggle(); else modeAmps = [];
    dirty = true;
  }

  function updateWiggle(dt) {
    const w = wiggleState;
    if (w.level !== w.target) {
      const step = dt / Math.max(0.01, opts.wiggleRamp);
      w.level = w.target > w.level ? Math.min(1, w.level + step) : Math.max(0, w.level - step);
    }
    if (w.level === 0) { modeAmps = []; return false; }
    w.time += dt * opts.wiggleSpeed;
    const level = w.level * w.level * (3 - 2 * w.level);
    modeAmps = opts.wiggle.filter(n => n in WIGGLE_MODES).map((name, i) => {
      const mode = WIGGLE_MODES[name];
      return { name, mode, a: level * opts.wiggleAmount * Math.sin(2 * Math.PI * mode.freq * w.time + i * 1.3) };
    });
    return true;
  }

  /** Where the model point (x, y) is drawn right now, with the wiggle applied. */
  function P(x, y) {
    if (modeAmps.length === 0) return [x, y];
    let dx = 0, dy = 0;
    const wb = bodyWeight(x);
    for (const { name, mode, a } of modeAmps) {
      const s = a * mode.size;
      if (name === 'breathe') {                       // body swells about the lower bout
        dx += wb * s * (x - 150); dy += wb * s * y;
      } else if (name === 'long') {                   // lower bout swells while the upper bout shrinks
        const wl = Math.min(1, Math.max(0, (330 - x) / 40));   // 1 on the lower bout, 0 on the upper
        const wu = 1 - wl;
        dx += wb * s * (wl * (x - 140) - wu * (x - 405));
        dy += wb * s * y * (wl - wu);
      } else if (name === 'cross') {                  // the lower bout rocks sideways
        dy += wb * s * Math.exp(-(((x - 150) / 140) ** 2));
      } else if (name === 'bend') {                   // free bar: ends in phase, middle opposite
        dy += s * Math.cos(2 * Math.PI * x / X_END);
      } else if (name === 'neck') {                   // cantilever clamped at the body
        const xi = Math.max(0, (x - BODY_END) / (X_END - BODY_END));
        dy += s * xi * xi * (3 - xi) / 2;
      }
    }
    return [x + dx, y + dy];
  }

  // Path helpers that bend straight lines along with the wiggle
  function moveTo(x, y) { const [u, v] = P(x, y); ctx.moveTo(u, v); }
  function lineTo(x, y) { const [u, v] = P(x, y); ctx.lineTo(u, v); }
  function segment(x0, y0, x1, y1, n = 1) {
    if (modeAmps.length === 0) n = 1;
    for (let j = 1; j <= n; j++) lineTo(x0 + (x1 - x0) * j / n, y0 + (y1 - y0) * j / n);
  }
  function polygon(points, n = 1) {
    ctx.beginPath();
    moveTo(...points[0]);
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      segment(a[0], a[1], b[0], b[1], n);
    }
    ctx.closePath();
  }

  // ---------- Mouse / touch interaction ----------

  /** y of the (straight) string i at position X. */
  function lineY(i, X) {
    const { x0, y0, x1, y1 } = stringEnds(i);
    return y0 + (y1 - y0) * (X - x0) / (x1 - x0);
  }

  /** Which string is under the model point (X, Y)? Returns its index, or -1. */
  function hitString(X, Y) {
    if (!opts.strings) return -1;
    const { x0, x1 } = stringEnds(0);
    if (X < x0 || X > x1) return -1;
    const spacing = Math.abs(lineY(1, X) - lineY(0, X));   // local distance between neighbouring strings
    let best = -1, bestDist = 0.5 * spacing;               // the pointer must be within half a spacing
    for (let i = 0; i < 6; i++) {
      const dist = Math.abs(Y - lineY(i, X));
      if (dist <= bestDist) { best = i; bestDist = dist; }
    }
    return best;
  }

  /** Update the held string's shape from the pointer: the peak follows the pointer. */
  function holdFrom(e) {
    const { X, Y } = toModel(e);
    const { x0, x1 } = stringEnds(held.i);
    held.xFrac = Math.min(0.98, Math.max(0.02, (X - x0) / (x1 - x0)));
    const h = Y - lineY(held.i, x0 + held.xFrac * (x1 - x0));
    held.h = Math.max(-opts.maxPull, Math.min(opts.maxPull, h));
    dirty = true;
  }

  function onPointerDown(e) {
    const { X, Y } = toModel(e);
    const i = hitString(X, Y);
    if (i < 0) return;
    canvas.setPointerCapture(e.pointerId);                 // keep receiving events outside the canvas
    strings[i].active = false;                             // a finger on the string stops it
    held = { i, xFrac: 0.3, h: 0, dragged: false, startX: e.clientX, startY: e.clientY };
    holdFrom(e);
    canvas.style.cursor = 'grabbing';
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (held) {
      holdFrom(e);
      if (Math.hypot(e.clientX - held.startX, e.clientY - held.startY) > 3) held.dragged = true;
      return;
    }
    const { X, Y } = toModel(e);
    canvas.style.cursor = hitString(X, Y) >= 0 ? 'grab' : 'default';
  }

  function onPointerUp() {
    if (!held) return;
    const { i, xFrac, h, dragged } = held;
    held = null;
    canvas.style.cursor = 'default';
    // A plain click plucks with the default height towards the side that was clicked;
    // a drag releases the string from the shape it was pulled into.
    const height = (dragged && Math.abs(h) >= 0.5) ? h : (h < 0 ? -opts.pluckHeight : opts.pluckHeight);
    pluck(i, xFrac, height);
  }

  if (opts.interactive) {
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
  }

  // ---------- Drawing ----------

  // Any CSS color -> "r, g, b" (the canvas does the parsing)
  const rgbCache = new Map();
  function toRgb(color) {
    if (!rgbCache.has(color)) {
      ctx.fillStyle = '#000';
      ctx.fillStyle = color;
      const hex = ctx.fillStyle;                           // normalised to #rrggbb
      const n = parseInt(hex.slice(1), 16);
      rgbCache.set(color, hex.startsWith('#') ? `${n >> 16}, ${(n >> 8) & 255}, ${n & 255}` : '255, 255, 255');
    }
    return rgbCache.get(color);
  }

  function drawPatches() {
    if (!opts.wigglePatches || modeAmps.length === 0) return;
    ctx.save();
    ctx.beginPath();
    smoothClosedPath(ctx, OUTLINE.map(([x, y]) => P(x, y)));
    ctx.clip();
    for (const { mode, a } of modeAmps) {
      for (const [x, y, r, sign] of mode.patches) {
        const v = sign * a;                                // signed: towards (+) or away (-)
        const [cx, cy] = P(x, y);
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        const rgb = toRgb(v > 0 ? opts.wiggleColors[1] : opts.wiggleColors[0]);
        g.addColorStop(0, `rgba(${rgb}, 1)`);
        g.addColorStop(0.5, `rgba(${rgb}, 0.7)`);
        g.addColorStop(1, `rgba(${rgb}, 0)`);                // fade to transparent, not to black
        ctx.globalAlpha = Math.min(1, Math.abs(v)) * opts.wiggleOpacity;
        ctx.fillStyle = g;
        ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
      }
    }
    ctx.restore();
  }

  function draw() {
    // Clear in device pixels, then switch to model coordinates (mm, y up)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const { k, cx } = getView();
    ctx.setTransform(ratio * k, 0, 0, -ratio * k,
                     ratio * (opts.width / 2 - k * cx), ratio * (opts.height / 2));
    const px = 1 / k;                              // one CSS pixel, in model units

    // Body
    ctx.beginPath();
    smoothClosedPath(ctx, OUTLINE.map(([x, y]) => P(x, y)));
    ctx.fillStyle = opts.bodyColor;
    ctx.fill();
    ctx.lineWidth = 2 * px;
    ctx.strokeStyle = opts.edgeColor;
    ctx.stroke();

    drawPatches();

    // Fretboard (a long trapezoid, slightly wider towards the body)
    polygon([[X_FRETBOARD_END, BOARD_END_HALF_WIDTH], [X_NUT, NUT_HALF_WIDTH],
             [X_NUT, -NUT_HALF_WIDTH], [X_FRETBOARD_END, -BOARD_END_HALF_WIDTH]], 24);
    ctx.fillStyle = opts.neckColor;
    ctx.fill();

    // Headstock with six tuning pegs
    polygon([[X_NUT, NUT_HALF_WIDTH], [X_END, NUT_HALF_WIDTH + 5],
             [X_END, -(NUT_HALF_WIDTH + 5)], [X_NUT, -NUT_HALF_WIDTH]], 6);
    ctx.fillStyle = opts.headColor;
    ctx.fill();
    ctx.fillStyle = opts.stringColor;
    for (const f of [0.25, 0.5, 0.75]) {
      for (const s of [1, -1]) {
        const [u, v] = P(X_NUT + f * HEADSTOCK_LENGTH, s * 31);
        ctx.beginPath();
        ctx.arc(u, v, 5, 0, 2 * Math.PI);
        ctx.fill();
      }
    }

    // Frets (the fretboard narrows towards the nut)
    ctx.strokeStyle = opts.fretColor;
    ctx.lineWidth = 1.5 * px;
    for (let n = 1; n <= NUM_FRETS; n++) {
      const x = X_NUT - fretDistance(n);
      const hw = fretboardHalfWidth(x);
      ctx.beginPath();
      moveTo(x, hw);
      lineTo(x, -hw);
      ctx.stroke();
    }

    // Nut
    ctx.strokeStyle = opts.nutColor;
    ctx.lineWidth = 3 * px;
    ctx.beginPath();
    moveTo(X_NUT, NUT_HALF_WIDTH);
    lineTo(X_NUT, -NUT_HALF_WIDTH);
    ctx.stroke();

    // Sound hole (it follows the body, and breathes with it)
    const breathe = modeAmps.find(m => m.name === 'breathe');
    const holeR = SOUND_HOLE.r * (1 + (breathe ? breathe.a * breathe.mode.size : 0));
    const [hx, hy] = P(SOUND_HOLE.x, 0);
    ctx.beginPath();
    ctx.arc(hx, hy, holeR, 0, 2 * Math.PI);
    ctx.fillStyle = opts.holeColor;
    ctx.fill();
    ctx.lineWidth = 3 * px;
    ctx.strokeStyle = opts.edgeColor;
    ctx.stroke();

    // Bridge
    polygon([[X_BRIDGE - 8, -50], [X_BRIDGE + 8, -50], [X_BRIDGE + 8, 50], [X_BRIDGE - 8, 50]]);
    ctx.fillStyle = opts.headColor;
    ctx.fill();

    if (!opts.strings) return;

    // Strings: thickest at the bottom (low E), thinnest at the top.
    // A held string is a triangle; a vibrating one is the straight line plus the sum of its modes.
    ctx.lineJoin = 'round';
    for (let i = 0; i < 6; i++) {
      const { x0, y0, x1, y1 } = stringEnds(i);
      const st = strings[i];
      const isHeld = held !== null && held.i === i;
      ctx.strokeStyle = isHeld ? opts.holdColor : opts.stringColor;
      ctx.lineWidth = (2.4 - 0.28 * i) * px;
      ctx.beginPath();
      if (isHeld) {
        const xg = x0 + held.xFrac * (x1 - x0);
        const yg = y0 + held.xFrac * (y1 - y0) + held.h;
        moveTo(x0, y0);
        segment(x0, y0, xg, yg, 12);
        segment(xg, yg, x1, y1, 24);
      } else if (st.active && st.t >= 0) {
        for (let j = 0; j <= M; j++) {
          const f = j / M;
          let d = 0;                                          // displacement in mm
          for (let n = 1; n <= st.nModes; n++) d += st.a[n] * sinTable[n * (M + 1) + j];
          const x = x0 + (x1 - x0) * f;
          const y = y0 + (y1 - y0) * f + d;
          if (j === 0) moveTo(x, y); else lineTo(x, y);
        }
      } else {
        moveTo(x0, y0);
        segment(x0, y0, x1, y1, 32);
      }
      ctx.stroke();
    }
  }

  // ---------- Animation loop ----------
  // It only redraws while something moves (or after a change), so an idle guitar costs almost nothing.

  let frameId = null;
  let last = performance.now();

  function animate() {
    frameId = requestAnimationFrame(animate);
    const nowMs = performance.now();
    const dt = Math.min((nowMs - last) / 1000, 0.1);
    last = nowMs;
    const now = nowMs / 1000;

    let anyActive = updateWiggle(dt);
    for (let i = 0; i < 6; i++) {
      const st = strings[i];
      if (!st.active) continue;
      anyActive = true;
      st.t = now - st.t0;
      if (st.t < 0) continue;                                 // still waiting for its strum delay
      const f1 = TUNING[i] / opts.slowdown;
      modeAmplitudesAt(st.b, st.nModes, f1, opts.stiffness, opts.decayTime, opts.decaySlope, st.t, st.a);
      // The fundamental decays slowest: once it is invisible, the string is at rest
      if (Math.abs(st.b[1]) * Math.exp(-st.t / opts.decayTime) < 0.05) {
        st.active = false;
        dirty = true;                                         // one last redraw with the straight string
      }
    }

    if (anyActive || dirty) {
      draw();
      dirty = false;
    }
  }

  function start() {
    if (frameId !== null) return;      // already running
    last = performance.now();
    dirty = true;
    animate();
  }

  function stop() {
    if (frameId === null) return;
    cancelAnimationFrame(frameId);
    frameId = null;
  }

  resize();
  start();

  return {
    start,
    stop,
    pluck,
    strum,
    wiggle,                            // wiggle() or wiggle('breathe, neck'): start (fades in)
    stopWiggle,                        // fade out
    snapWiggle,                        // snapWiggle(true / false): on / off at once
    get wiggling() { return wiggleState.target === 1; },
    // change options while it runs (slowdown, decayTime, ... apply from the next pluck on)
    set(newOpts) {
      Object.assign(opts, newOpts);
      resize();
      dirty = true;
      if (frameId === null) draw();
    },
    dispose() {
      stop();
      canvas.remove();
    }
  };
}
