// plugins/lib/rays.js
//
// Acoustic (p-mode) rays inside a star, for the cut-open stars (stellar.js "rays" region and the
// pulsating star's cut). A sound wave of degree l and angular frequency omega travels along a ray
// that bends away from the hot, fast centre: it dives in, turns at its inner turning point (where
// c(r) / r = omega / sqrt(l(l+1)), the Lamb frequency), comes back up and is reflected at the surface.
// Low l dive deep, high l stay shallow.
//
// The rays are traced like a light ray (geometric acoustics), with a simple sound-speed profile:
// slow at the surface, fast in the core. Units: the star's radius = 1, core sound speed = 1.
//
//   traceSkip(l, { omega })              -> one surface-to-surface skip (later skips: the same, turned)
//   traceRay(l, { omega, bounces })      -> { x, y, t, rTurn, duration }   (x, y: the ray in the disc)
//   createRayPainter(options)            -> { canvas, setSize(px), draw(time), rays }
//
// The painter draws the rays into a square canvas (used as a texture on the cut faces): each ray runs
// on for ever with an arrowhead at its head, and its trail fades out behind it before the head comes
// round again.
// The disc of the star (radius 1) fills DISC of the canvas, centred, with y up.

export const DISC = 0.92;                     // the star's radius in the canvas, as a fraction of its half-size

// ---------- The star: sound speed ----------

const C_SURFACE = 0.05;
const C_CORE = 1.0;
export const soundSpeed = r => C_SURFACE + (C_CORE - C_SURFACE) * Math.pow(Math.max(0, 1 - r * r), 1.5);
const soundSpeedSlope = r => -3 * r * (C_CORE - C_SURFACE) * Math.sqrt(Math.max(0, 1 - r * r));

// ---------- Tracing one ray ----------

const R_SURFACE = 0.995;                      // where the rays are reflected
const DT = 0.002;                             // integration step (time units: radius / core sound speed)

// d/dt of (r, theta, kr): the ray equations, Hamilton's equations for omega = c(r) k, so omega stays
// constant along the ray and it turns exactly where c / r = omega / sqrt(l(l+1))
function rates(r, kr, L) {
  const c = soundSpeed(r);
  const kh = L / r;                           // horizontal wavenumber
  const k = Math.hypot(kr, kh);
  return [
    c * kr / k,                               // dr/dt      (the wave moves at the sound speed, along k)
    (c / r) * kh / k,                         // dtheta/dt
    -k * soundSpeedSlope(r) + c * kh * kh / (k * r),  // dkr/dt (bending away from the fast centre)
  ];
}

/**
 * One skip of the ray of a mode of degree l: from the surface at the top of the star (theta = 0), in,
 * round its turning point and back out to the surface, going clockwise. Every later skip is the same
 * path turned on by the skip angle, so the ray can run on for ever.
 * Returns the points (r, theta, and the time at each), the skip angle and time, and the turning radius.
 */
export function traceSkip(l, { omega = 25 } = {}) {
  const L = Math.sqrt(Math.max(0, l * (l + 1)));
  let r = R_SURFACE, theta = 0;
  const kh0 = L / r;
  let kr = -Math.sqrt(Math.max(0, (omega / soundSpeed(r)) ** 2 - kh0 * kh0));
  if (!(kr < 0)) kr = -1e-6;                  // (a mode that cannot reach this deep still starts inwards)

  const rs = [r], ths = [0], ts = [0];
  let t = 0, rTurn = r;
  const step = (r, th, kr, h) => {            // one Runge-Kutta step
    const a = rates(r, kr, L);
    const b = rates(r + 0.5 * h * a[0], kr + 0.5 * h * a[2], L);
    const c = rates(r + 0.5 * h * b[0], kr + 0.5 * h * b[2], L);
    const d = rates(r + h * c[0], kr + h * c[2], L);
    return [r + h / 6 * (a[0] + 2 * b[0] + 2 * c[0] + d[0]),
            th + h / 6 * (a[1] + 2 * b[1] + 2 * c[1] + d[1]),
            kr + h / 6 * (a[2] + 2 * b[2] + 2 * c[2] + d[2])];
  };

  let lx = 0, ly = r;
  for (let n = 0; n < 400000; n++) {
    [r, theta, kr] = step(r, theta, kr, DT);
    t += DT;
    if (r < 1e-3) {                           // l = 0: straight through the centre and out the other side
      r = 1e-3; theta += Math.PI; kr = Math.abs(kr);
    }
    rTurn = Math.min(rTurn, r);
    const out = r >= R_SURFACE && kr > 0;     // back at the surface: the skip is done
    if (out) r = R_SURFACE;
    const x = r * Math.sin(theta), y = r * Math.cos(theta);
    if (out || Math.hypot(x - lx, y - ly) > 0.004) {   // keep a point every so often
      rs.push(r); ths.push(theta); ts.push(t); lx = x; ly = y;
    }
    if (out) break;
  }
  return { r: Float32Array.from(rs), theta: Float32Array.from(ths), t: Float32Array.from(ts),
           skipAngle: theta, skipTime: t, rTurn };
}

/** The ray drawn out over a number of skips (default: about once round the star), as x, y points (y up). */
export function traceRay(l, { omega = 25, bounces = null } = {}) {
  const skip = traceSkip(l, { omega });
  const n = bounces ?? Math.max(1, Math.round(2 * Math.PI / skip.skipAngle));
  const xs = [], ys = [], ts = [];
  for (let k = 0; k < n; k++) {
    for (let j = k ? 1 : 0; j < skip.r.length; j++) {
      const th = k * skip.skipAngle + skip.theta[j];
      xs.push(skip.r[j] * Math.sin(th)); ys.push(skip.r[j] * Math.cos(th)); ts.push(k * skip.skipTime + skip.t[j]);
    }
  }
  return { x: Float32Array.from(xs), y: Float32Array.from(ys), t: Float32Array.from(ts),
           rTurn: skip.rTurn, duration: n * skip.skipTime };
}

// ---------- Drawing them ----------

const UNITS_PER_SECOND = 4;                   // ray time units per second, at speed 1
export const RAY_COLORS = ['#e0115f', '#1e6fe0', '#13a04a', '#f08a00', '#8e2bd6', '#00a5b5'];

/**
 * options: { modes: [l, ...], frequencies: [f, ...], omega, trail, speed, colors, width }
 *   frequencies: each mode's frequency in units of the reference frequency (for the pulsating star:
 *                its pulsation rate); omega = the reference frequency in the rays' own units (core sound
 *                speed / radius). So mode i is traced with omega * frequencies[i]. One value = all modes.
 *   trail: how long the trail behind the head lasts, as a fraction of the time the ray takes once round
 *          the star (below 1: the old path has faded before the head comes round again)
 *   speed: 1 = 4 time units per second (l = 1 takes about 3 s round the star, l = 21 about 8 s)
 *   loop: seconds (0 = off): the picture repeats exactly after this time (for looping animations)
 *   width: line width, 1 = default
 * The rays run on for ever. A mode listed more than once ([1, 1, 1]) gets one ray per copy, the copies
 * starting evenly spread round the star.
 */
export function createRayPainter(options = {}) {
  const o = { modes: [2], frequencies: [1], omega: 25, trail: 0.8, speed: 1, colors: RAY_COLORS, width: 1, loop: 0, ...options };
  const freqs = o.frequencies?.length ? o.frequencies : [1];
  const trail = Math.max(0.05, Number(o.trail) || 0.8);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  const frequencyOf = i => Number(freqs[Math.min(i, freqs.length - 1)]) || 1;
  const rays = o.modes.map((l, i) => {
    const frequency = frequencyOf(i);
    const skip = traceSkip(l, { omega: o.omega * frequency });
    const roundTime = skip.skipTime * 2 * Math.PI / skip.skipAngle;   // once round the star (ray units)
    // the same mode more than once (data-rays="1, 1, 1"): the copies start spread evenly round the star
    const same = o.modes.map((m, j) => j).filter(j => o.modes[j] === l && frequencyOf(j) === frequency);
    return {
      l, frequency, ...skip,
      start: same.length > 1 ? 2 * Math.PI * same.indexOf(i) / same.length : 0,   // where it starts (from the top)
      flip: i % 2 ? -1 : 1,                   // every other mode goes the other way round
      color: o.colors[i % o.colors.length],
      trailTime: trail * roundTime,
      rate: UNITS_PER_SECOND * o.speed,      // ray time units per second
      drift: 0,                              // extra turn of the whole ray, radians per second
      turn: 0,                               // ... and how far it has turned now
    };
  });
  // loop (seconds, for looping animations): the picture must repeat after exactly that time. Each ray
  // makes a whole number of skips in it (its pace nudged a little), and the small angle by which that
  // misses a whole number of turns is taken out by turning the ray very slowly over the loop.
  if (o.loop > 0) {
    for (const ray of rays) {
      const skips = Math.max(1, Math.round(o.loop * ray.rate / ray.skipTime));
      const turns = Math.round(skips * ray.skipAngle / (2 * Math.PI));
      ray.rate = skips * ray.skipTime / o.loop;
      ray.drift = -(skips * ray.skipAngle - 2 * Math.PI * turns) / o.loop;
    }
  }

  let size = 0;
  function setSize(px) {
    px = Math.max(128, Math.min(2048, Math.round(px)));
    if (px === size) return;
    size = canvas.width = canvas.height = px;
  }
  setSize(512);

  // the point j of skip k of a ray (in the disc, y up) and its time
  const pointOf = (ray, k, j) => {
    const th = ray.start + ray.turn + k * ray.skipAngle + ray.theta[j];
    return [ray.flip * ray.r[j] * Math.sin(th), ray.r[j] * Math.cos(th), k * ray.skipTime + ray.t[j]];
  };
  // the index of the last point of a skip at or before local time tl
  const indexAt = (ray, tl) => {
    let lo = 0, hi = ray.t.length - 1;
    if (tl >= ray.t[hi]) return hi;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (ray.t[mid] <= tl) lo = mid; else hi = mid; }
    return lo;
  };

  const CHUNK = 6;                            // points per stroke (each stroke has its own fade)
  function draw(time) {
    const s = size, half = s / 2, k = half * DISC;
    const lw = Math.max(1.5, 2.2 * s / 600) * Math.max(0.05, Number(o.width) || 1);   // width scales it on any star
    ctx.clearRect(0, 0, s, s);
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'round';
    for (const ray of rays) {
      const simNow = time * ray.rate;
      ray.turn = ray.drift * time;
      // the inner turning point: a dotted circle
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = ray.color;
      ctx.lineWidth = Math.max(1, lw * 0.5);
      ctx.setLineDash([lw * 0.8, lw * 2.2]);
      ctx.beginPath();
      ctx.arc(half, half, Math.max(0, ray.rTurn) * k, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.setLineDash([]);

      // the points of the trail, from its faded end up to the head
      const T = ray.skipTime, last = ray.t.length - 1;
      const tFrom = Math.max(0, simNow - ray.trailTime);
      const kHead = Math.floor(simNow / T), kFrom = Math.floor(tFrom / T);
      const pts = [];                           // [x, y, age]
      const add = (x, y, t) => pts.push([half + x * k, half - y * k, simNow - t]);
      for (let kk = kFrom; kk <= kHead; kk++) {
        const j0 = kk === kFrom ? indexAt(ray, tFrom - kk * T) + 1 : 1;
        const j1 = kk === kHead ? indexAt(ray, simNow - kk * T) : last;
        if (kk === kFrom) {                     // the exact faded end
          const j = j0 - 1, f = Math.min(1, (tFrom - kk * T - ray.t[j]) / Math.max(1e-9, ray.t[Math.min(last, j + 1)] - ray.t[j]));
          const a = pointOf(ray, kk, j), b = pointOf(ray, kk, Math.min(last, j + 1));
          add(a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1]), tFrom);
        }
        for (let j = j0; j <= j1; j++) { const p = pointOf(ray, kk, j); add(p[0], p[1], p[2]); }
      }
      { // the exact head
        const j = indexAt(ray, simNow - kHead * T), jn = Math.min(last, j + 1);
        const f = Math.min(1, (simNow - kHead * T - ray.t[j]) / Math.max(1e-9, ray.t[jn] - ray.t[j]));
        const a = pointOf(ray, kHead, j), b = pointOf(ray, kHead, jn);
        add(a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1]), simNow);
      }
      if (pts.length < 2) continue;

      // the trail: fading with age, gone after trailTime
      ctx.lineWidth = lw;
      for (let a = 0; a < pts.length - 1; a += CHUNK) {
        const b = Math.min(pts.length - 1, a + CHUNK);
        const age = 0.5 * (pts[a][2] + pts[b][2]);
        const fade = Math.max(0, 1 - age / ray.trailTime);
        if (fade <= 0) continue;
        ctx.globalAlpha = fade * fade * (3 - 2 * fade);   // smooth fade
        ctx.beginPath();
        ctx.moveTo(pts[a][0], pts[a][1]);
        for (let j = a + 1; j <= b; j++) ctx.lineTo(pts[j][0], pts[j][1]);
        ctx.stroke();
      }

      // the head: an arrowhead pointing the way the wave travels
      const len = lw * 5.5;
      const [hx, hy] = pts[pts.length - 1];
      let j = pts.length - 2, [bx, by] = pts[j];
      while (j > 0 && Math.hypot(hx - bx, hy - by) < 0.6 * len) { j--; [bx, by] = pts[j]; }
      const d = Math.hypot(hx - bx, hy - by);
      if (d > 1e-6) {
        const ux = (hx - bx) / d, uy = (hy - by) / d;          // direction of travel
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.moveTo(hx + 0.35 * len * ux, hy + 0.35 * len * uy);                       // tip, a little ahead
        ctx.lineTo(hx - 0.65 * len * ux - 0.45 * len * uy, hy - 0.65 * len * uy + 0.45 * len * ux);
        ctx.lineTo(hx - 0.4 * len * ux, hy - 0.4 * len * uy);                           // notch
        ctx.lineTo(hx - 0.65 * len * ux + 0.45 * len * uy, hy - 0.65 * len * uy - 0.45 * len * ux);
        ctx.closePath();
        ctx.fillStyle = ray.color;
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  return { canvas, setSize, draw, rays };
}
