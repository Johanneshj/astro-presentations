// plugins/guitar.js
// A minimalistic guitar that wiggles in cartoon vibration modes:
//   - 'edge': small waves running around the edge of the body (seen straight from the front)
//   - motions of the whole instrument: the top plate breathing or rocking, the body bending, the neck
//     swinging. These move out of the plane of the top plate, so you cannot see them from the front:
//     the guitar first turns to be seen at a slant (like a computer model of a vibrating guitar).
//     It stays a flat surface (no box) in every pose.
// Geometry (outline, neck, depths) lives in guitarGeometry.js.
// As a slide element: <div class="guitar">, see guitarPlugin.js / docs/guitar.md.

import {
  X_BRIDGE, X_NUT, X_END, X_FRETBOARD_END, HEADSTOCK_LENGTH, NUM_FRETS, BODY_END,
  NUT_HALF_WIDTH, SOUND_HOLE, OUTLINE,
  fretDistance, fretboardHalfWidth,
} from './guitarGeometry.js';
import { pixelRatio } from './lib/revealHelpers.js';

// ---------- Body outline, sampled once ----------

/** Points along a smooth closed curve through P (uniform Catmull-Rom), `per` samples per segment. */
function sampleClosed(P, per) {
  const n = P.length, out = [];
  for (let i = 0; i < n; i++) {
    const p0 = P[(i - 1 + n) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n];
    for (let j = 0; j < per; j++) {
      const t = j / per, t2 = t * t, t3 = t2 * t;
      const c = k => 0.5 * (2 * p1[k] + (p2[k] - p0[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2
                            + (3 * p1[k] - p0[k] - 3 * p2[k] + p3[k]) * t3);
      out.push([c(0), c(1)]);
    }
  }
  return out;
}

// The outline as ~250 points, each with its distance s along the edge and the outward normal
const EDGE = (() => {
  const pts = sampleClosed(OUTLINE, 12);
  const n = pts.length;
  let s = 0;
  return pts.map((p, i) => {
    const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    const tx = b[0] - a[0], ty = b[1] - a[1], len = Math.hypot(tx, ty) || 1;
    if (i > 0) s += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
    // The outline runs clockwise (upper half first), so the outward normal is the tangent turned left
    return { x: p[0], y: p[1], nx: -ty / len, ny: tx / len, s };
  });
})();
const EDGE_LENGTH = EDGE[EDGE.length - 1].s + Math.hypot(EDGE[0].x - EDGE.at(-1).x, EDGE[0].y - EDGE.at(-1).y);

// Half-width of the body at x, read off the upper half of the sampled outline
const HALF_WIDTH = (() => {
  const upper = EDGE.filter(p => p.y >= 0).sort((a, b) => a.x - b.x);
  const table = new Float32Array(BODY_END + 1);
  let j = 0;
  for (let x = 0; x <= BODY_END; x++) {
    while (j < upper.length - 2 && upper[j + 1].x < x) j++;
    const a = upper[j], b = upper[j + 1];
    const f = Math.min(1, Math.max(0, (x - a.x) / ((b.x - a.x) || 1)));
    table[x] = a.y + f * (b.y - a.y);
  }
  return table;
})();
function halfWidth(x) {
  if (x <= 0 || x >= BODY_END) return 0;
  const i = Math.floor(x), f = x - i;
  return HALF_WIDTH[i] * (1 - f) + HALF_WIDTH[Math.min(BODY_END, i + 1)] * f;
}

// ---------- Mode shapes ----------
// Shapes of the top plate are 0 at the edge of the body (the plate is glued to the sides there).
const eta = (x, y) => { const h = halfWidth(x); return h > 0 ? Math.max(-1, Math.min(1, y / h)) : 0; };
const across = (x, y) => 1 - eta(x, y) ** 2;                                       // 1 in the middle, 0 at the edge
const lowerBout = x => (x > 0 && x < 300 ? Math.sin(Math.PI * x / 300) ** 2 : 0);   // a bump on the lower bout
const upperBout = x => (x > 300 && x < BODY_END ? Math.sin(Math.PI * (x - 300) / (BODY_END - 300)) ** 2 : 0);

// First bending mode of a free bar (exact shape): both ends one way, the middle the other way
function freeBar(xi) {
  const b = 4.730041 * xi, sigma = 0.982502;
  return (Math.cosh(b) + Math.cos(b) - sigma * (Math.sinh(b) + Math.sin(b))) / 2;   // 1 at the ends
}

// ---------- Toy modes ----------
// Not a model of a real guitar, but each one is a kind of motion real guitars do have.
//   kind   'edge' = waves around the edge, in the plane of the top (no turning needed)
//          'top'  = the top plate moves in and out (the box itself stays)
//          'body' = the whole instrument moves (top, back and neck together)
//   freq   wiggles per second on screen;  size  mm at amount 1
//   shape(x, y)  how much each point of the top takes part (-1..1)
export const WIGGLE_MODES = {
  edge:    { kind: 'edge', freq: 1.0, size: 3, waves: 16 },   // waves: number of waves around the body
  breathe: { kind: 'top',  freq: 1.1, size: 16,               // the top swells in and out ("monopole")
             shape: (x, y) => across(x, y) * (lowerBout(x) + 0.35 * upperBout(x)) },
  cross:   { kind: 'top',  freq: 1.6, size: 14,               // one side of the lower bout up, the other down
             shape: (x, y) => 2.6 * eta(x, y) * across(x, y) * lowerBout(x) },
  long:    { kind: 'top',  freq: 1.9, size: 14,               // lower and upper bout opposite
             shape: (x, y) => across(x, y) * (lowerBout(x) - upperBout(x)) },
  bend:    { kind: 'body', freq: 0.8, size: 35,               // the whole guitar flexes like a free bar
             shape: x => freeBar(x / X_END) },
  neck:    { kind: 'body', freq: 0.6, size: 60,               // the neck swings like a diving board
             shape: x => { const xi = Math.max(0, (x - BODY_END) / (X_END - BODY_END)); return xi * xi * (3 - xi) / 2; } },
};
const MODE_NAMES = Object.keys(WIGGLE_MODES);
const turns = name => WIGGLE_MODES[name]?.kind !== 'edge';     // does this mode need the slanted view?

const smooth = t => t * t * (3 - 2 * t);
const DEG = Math.PI / 180;

export function createGuitar(container, options = {}) {
  const opts = {
    width: 800, height: 373,         // layout size in CSS pixels
    renderScale: 1,                  // render-resolution multiplier (for reveal's slide scale)
    bodyColor: '#8a5a2b',
    edgeColor: '#3d2611',
    neckColor: '#3b2a1a',
    headColor: '#2b1d12',
    holeColor: '#1a1008',
    fretColor: '#c9c2b4',
    nutColor: '#e8e0cf',

    // ---- view ----
    tilt: 0,                         // degrees: 0 = seen straight from the front
    wiggleTilt: 60,                  // tilt while the whole-instrument modes run (it turns there and back)
    yaw: 0,                          // degrees: turn about the vertical (neck towards / away from you)
    angle: 0,                        // degrees: rotation in the plane of the slide
    turnTime: 1.2,                   // seconds to turn

    // ---- wiggle ----
    wiggle: [],                      // modes to wiggle in from the start; names from WIGGLE_MODES
    wiggleAmount: 1,                 // overall size of the wiggle
    wiggleSpeed: 1,                  // overall speed of the wiggle
    wiggleRamp: 0.8,                 // seconds to fade a mode in / out
    ...options,
  };

  const known = new Set(Object.keys(opts));
  for (const key of Object.keys(options)) {
    if (!known.has(key)) console.warn(`createGuitar: unknown option "${key}"`);
  }

  container.style.width = opts.width + 'px';
  container.style.height = opts.height + 'px';
  const canvas = document.createElement('canvas');
  canvas.style.width = opts.width + 'px';
  canvas.style.height = opts.height + 'px';
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  let ratio = 1;
  function resize() {
    ratio = pixelRatio(opts.renderScale, opts.width, opts.height);
    canvas.width = Math.round(opts.width * ratio);
    canvas.height = Math.round(opts.height * ratio);
  }

  // ---------- Wiggle state ----------
  // target: the modes asked for; level[name]: 0..1 fade of each mode; turn: 0 = front view, 1 = slanted.
  // Order of things: turn first, then wiggle; when stopping, calm down first, then turn back.
  const state = { target: [], level: new Map(), turn: 0, time: 0 };
  let active = [];                   // this frame: [{ name, mode, a }] with a = signed amplitude (-1..1)
  let dirty = true;

  function cleanList(modes) {
    const list = Array.isArray(modes) ? modes : String(modes ?? '').split(',');
    return list.map(s => String(s).trim()).filter(s => s && s !== 'none').filter(name => {
      if (name in WIGGLE_MODES) return true;
      console.warn(`createGuitar: unknown wiggle mode "${name}" (use ${MODE_NAMES.join(', ')})`);
      return false;
    });
  }

  /** Wiggle in these modes from now on ([] or 'none' = calm down). snap = at once, without fading or turning. */
  function setWiggle(modes, snap = false) {
    state.target = cleanList(modes);
    if (snap) {
      state.level = new Map(state.target.map(n => [n, 1]));
      state.turn = state.target.some(turns) ? 1 : 0;
      updateActive();
    }
    dirty = true;
    if (frameId === null) draw();
  }

  function updateWiggle(dt) {
    const want = new Set(state.target);
    const wantTurn = state.target.some(turns);
    const stillMoving = [...state.level].some(([n, l]) => turns(n) && l > 0);
    const turnStep = opts.turnTime > 0 ? dt / opts.turnTime : 1;
    const turnBefore = state.turn;
    if (wantTurn) state.turn = Math.min(1, state.turn + turnStep);
    else if (!stillMoving) state.turn = Math.max(0, state.turn - turnStep);

    const step = dt / Math.max(0.01, opts.wiggleRamp);
    for (const name of new Set([...want, ...state.level.keys()])) {
      const goal = want.has(name) && (!turns(name) || state.turn >= 1) ? 1 : 0;
      const l = state.level.get(name) ?? 0;
      const next = goal > l ? Math.min(1, l + step) : Math.max(0, l - step);
      if (next === 0 && goal === 0) state.level.delete(name); else state.level.set(name, next);
    }
    if (state.level.size) state.time += dt * opts.wiggleSpeed;
    updateActive();
    return state.level.size > 0 || state.turn !== turnBefore;
  }

  function updateActive() {
    active = [...state.level].map(([name, l]) => {
      const mode = WIGGLE_MODES[name];
      const phase = MODE_NAMES.indexOf(name) * 1.3;
      return { name, mode, a: smooth(l) * Math.sin(2 * Math.PI * mode.freq * state.time + phase) };
    });
  }

  // ---------- Displacements ----------

  /** Out-of-plane displacement (mm) of the whole instrument at x. */
  function wBody(x) {
    let w = 0;
    for (const { mode, a } of active) if (mode.kind === 'body') w += a * mode.size * mode.shape(x);
    return w * opts.wiggleAmount;
  }

  /** Out-of-plane displacement (mm) of the top plate (or the neck on top of it) at (x, y). */
  function wTop(x, y) {
    let w = 0;
    for (const { mode, a } of active) if (mode.kind === 'top') w += a * mode.size * mode.shape(x, y);
    return w * opts.wiggleAmount + wBody(x);
  }

  /** In-plane push (mm) of the edge point at distance s along the outline: the travelling waves. */
  function edgePush(s) {
    let d = 0;
    for (const { mode, name } of active) {
      if (mode.kind !== 'edge') continue;
      const level = smooth(state.level.get(name) ?? 0);      // a travelling wave: no standing sine factor
      d += level * mode.size * Math.sin(2 * Math.PI * (mode.waves * s / EDGE_LENGTH - mode.freq * state.time));
    }
    return d * opts.wiggleAmount;
  }

  // ---------- View: model (mm; x along the guitar, y across, z out of the top) -> screen (mm, y up) ----------
  const XC = X_END / 2;              // the guitar turns about its middle
  let rot = null;                    // cos / sin of the current angles

  function setPose(tiltDeg) {
    const t = tiltDeg * DEG, y = opts.yaw * DEG, r = opts.angle * DEG;
    rot = { ct: Math.cos(t), st: Math.sin(t), cy: Math.cos(y), sy: Math.sin(y), cr: Math.cos(r), sr: Math.sin(r) };
  }

  function project(x, y, z) {
    const { ct, st, cy, sy, cr, sr } = rot;
    const y1 = y * ct + z * st;               // tilt about the long axis: the top leans back,
    const z1 = -y * st + z * ct;              // its lower side comes into view below it
    const x2 = (x - XC) * cy + z1 * sy;       // yaw about the vertical
    return [x2 * cr - y1 * sr, x2 * sr + y1 * cr];   // rotation in the slide's plane
  }

  const currentTilt = () => opts.tilt + (opts.wiggleTilt - opts.tilt) * smooth(state.turn);

  // Scale and centre so that the guitar fits in both poses (front and slanted), with room for the wiggle
  let fit = null;
  function computeFit() {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const add = ([u, v]) => { x0 = Math.min(x0, u); x1 = Math.max(x1, u); y0 = Math.min(y0, v); y1 = Math.max(y1, v); };
    const room = 30;                                              // mm of wiggle room
    for (const tilt of [opts.tilt, opts.wiggleTilt]) {
      setPose(tilt);
      for (let i = 0; i < EDGE.length; i += 6) {
        for (const z of [room, -room]) add(project(EDGE[i].x, EDGE[i].y, z));
      }
      for (const x of [BODY_END, X_NUT, X_END]) {
        for (const y of [-NUT_HALF_WIDTH - 15, NUT_HALF_WIDTH + 15]) {
          for (const z of [70, -70]) add(project(x, y, z));
        }
      }
    }
    const margin = 0.03 * Math.max(x1 - x0, y1 - y0);
    x0 -= margin; x1 += margin; y0 -= margin; y1 += margin;
    const k = Math.min(opts.width / (x1 - x0), opts.height / (y1 - y0));
    fit = { k, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
  }

  // ---------- Drawing ----------

  function polygon(points) {
    ctx.beginPath();
    points.forEach(([u, v], i) => (i ? ctx.lineTo(u, v) : ctx.moveTo(u, v)));
    ctx.closePath();
  }

  /** A flat strip of the neck between x0 and x1, half-width hw(x), at height z(x, y). */
  function strip(x0, x1, hw, z, n) {
    const top = [], bottom = [];
    for (let j = 0; j <= n; j++) {
      const x = x0 + (x1 - x0) * j / n, h = hw(x);
      top.push(project(x, h, z(x, h)));
      bottom.push(project(x, -h, z(x, -h)));
    }
    return top.concat(bottom.reverse());
  }

  // Half-width of the neck, headstock included
  const neckHalfWidth = x => (x <= X_NUT ? fretboardHalfWidth(x) : NUT_HALF_WIDTH + 5 * (x - X_NUT) / HEADSTOCK_LENGTH);

  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!fit) computeFit();
    const { k } = fit;
    ctx.setTransform(ratio * k, 0, 0, -ratio * k,
                     ratio * (opts.width / 2 - k * fit.cx), ratio * (opts.height / 2 + k * fit.cy));
    const px = 1 / k;                                       // one CSS pixel, in mm
    ctx.lineJoin = 'round';

    const tilt = currentTilt();
    setPose(tilt);

    // The edge of the body this frame (with the travelling waves), as model points
    const edge = EDGE.map(p => { const d = edgePush(p.s); return [p.x + p.nx * d, p.y + p.ny * d, p.x]; });
    const top = edge.map(([x, y, x0]) => project(x, y, wBody(x0)));

    // 1. The top plate
    polygon(top);
    ctx.fillStyle = opts.bodyColor;
    ctx.fill();


    polygon(top);
    ctx.lineWidth = 2 * px;
    ctx.strokeStyle = opts.edgeColor;
    ctx.stroke();

    // 2. Sound hole and bridge, riding on the top
    const hole = [];
    for (let j = 0; j < 48; j++) {
      const x = SOUND_HOLE.x + SOUND_HOLE.r * Math.cos(2 * Math.PI * j / 48);
      const y = SOUND_HOLE.r * Math.sin(2 * Math.PI * j / 48);
      hole.push(project(x, y, wTop(x, y)));
    }
    polygon(hole);
    ctx.fillStyle = opts.holeColor;
    ctx.fill();
    ctx.lineWidth = 3 * px;
    ctx.strokeStyle = opts.edgeColor;
    ctx.stroke();

    polygon([[X_BRIDGE - 8, -50], [X_BRIDGE + 8, -50], [X_BRIDGE + 8, 50], [X_BRIDGE - 8, 50]]
      .map(([x, y]) => project(x, y, wTop(x, y))));
    ctx.fillStyle = opts.headColor;
    ctx.fill();

    // 3. Neck: the fretboard and the headstock
    const zNeck = (x, y) => wTop(x, y);
    polygon(strip(X_FRETBOARD_END, X_NUT, fretboardHalfWidth, zNeck, 24));
    ctx.fillStyle = opts.neckColor;
    ctx.fill();

    polygon(strip(X_NUT, X_END, neckHalfWidth, zNeck, 6));
    ctx.fillStyle = opts.headColor;
    ctx.fill();

    // Tuning pegs: small discs on the headstock's sides
    ctx.fillStyle = opts.nutColor;
    for (const f of [0.25, 0.5, 0.75]) {
      for (const sign of [1, -1]) {
        const cx = X_NUT + f * HEADSTOCK_LENGTH, cy = sign * 31;
        const disc = [];
        for (let j = 0; j < 16; j++) {
          const x = cx + 5 * Math.cos(2 * Math.PI * j / 16), y = cy + 5 * Math.sin(2 * Math.PI * j / 16);
          disc.push(project(x, y, zNeck(x, 0)));
        }
        polygon(disc); ctx.fill();
      }
    }

    // Frets and nut
    ctx.strokeStyle = opts.fretColor;
    ctx.lineWidth = 1.5 * px;
    ctx.beginPath();
    for (let n = 1; n <= NUM_FRETS; n++) {
      const x = X_NUT - fretDistance(n), h = fretboardHalfWidth(x);
      ctx.moveTo(...project(x, h, zNeck(x, h)));
      ctx.lineTo(...project(x, -h, zNeck(x, -h)));
    }
    ctx.stroke();
    ctx.strokeStyle = opts.nutColor;
    ctx.lineWidth = 3 * px;
    ctx.beginPath();
    ctx.moveTo(...project(X_NUT, NUT_HALF_WIDTH, zNeck(X_NUT, 0)));
    ctx.lineTo(...project(X_NUT, -NUT_HALF_WIDTH, zNeck(X_NUT, 0)));
    ctx.stroke();
  }

  // ---------- Animation loop: redraws only while something moves ----------

  let frameId = null;
  let last = performance.now();

  function animate() {
    frameId = requestAnimationFrame(animate);
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (updateWiggle(dt) || dirty) {
      draw();
      dirty = false;
    }
  }

  function start() {
    if (frameId !== null) return;
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
  state.target = cleanList(opts.wiggle);
  start();

  return {
    start,
    stop,
    setWiggle,                         // setWiggle('edge') / setWiggle(['bend', 'neck']) / setWiggle('none'); (modes, true) = at once
    get wiggle() { return [...state.target]; },
    // change options while it runs
    set(newOpts) {
      Object.assign(opts, newOpts);
      if ('wiggle' in newOpts) state.target = cleanList(opts.wiggle);
      resize();
      fit = null;
      dirty = true;
      if (frameId === null) draw();
    },
    dispose() {
      stop();
      canvas.remove();
    },
  };
}
