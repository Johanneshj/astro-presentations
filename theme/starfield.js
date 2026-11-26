// theme/starfield.js
//
// 3D starfield behind the slides, as a reveal.js plugin:
//   - horizontal slide change (left / right): the camera turns about the vertical axis
//   - vertical slide change (up / down): the camera flies forward / backward
//   - smooth camera motion, stars wrap around periodically, spectral colors and sizes
//   - optional: slides zoom in / out with the camera on up / down, instead of sliding
//   - optional: a nebula (gas cloud) out in the starfield: <section data-nebula> is the slide that
//     faces it. On the slide before, it is far ahead; on its slide you have flown up to it; going on
//     down, you fly into it (and see its glow around you on the next slide).
//       data-nebula-fill="1.3"      its size on its own slide, as a fraction of the screen height
//       data-nebula-distance="220"  how far ahead it is from its slide (see forwardStep)
//       data-nebula-seed="1"        a different seed = a different cloud
//       data-nebula-speed="1"       how fast it slowly churns (0 = still)
//
// Usage: plugins: [ StarfieldPlugin, ... ]   (all numbers to tweak are in SETTINGS)
//   Reveal.initialize({ verticalTransition: 'zoom', ... })   transition for up / down moves only
//   (any reveal transition: 'zoom', 'fade', 'convex', ...; a slide's own data-transition still wins)

const SETTINGS = {
  totalStars: 500,
  sphereRadius: 1000,          // stars fill a box of +-sphereRadius around the camera
  forwardStep: 300,            // how far one vertical slide flies the camera
  rotationStep: Math.PI / 6,   // how far one horizontal slide turns the camera (radians)
  smoothingTime: 0.325,        // seconds; bigger = slower, softer camera motion
  focalLength: 600,
  maxPixelRatio: 2,            // render resolution cap (the field is soft anyway)
  glowBlur: 14,                // glow around the brightest stars
  nebulaPixels: 640,           // resolution of the nebula picture (it is soft, so it is scaled up)
  nebulaResolution: 0.5,       // the nebula's own canvas, in pixels per CSS pixel (soft, so low is fine and fast)
};

// ---------- The nebula: a picture made once from noise, drawn as a billboard in the starfield ----------
// Loosely after the Rosette nebula: a ring of glowing gas round a dark hollow with young stars in it,
// red outside, orange in between, green-yellow inside, crossed by dark dust lanes.

function makeNoise(seed) {
  const perm = new Uint8Array(512);
  const p = Array.from({ length: 256 }, (_, i) => i);
  let r = seed * 9301 + 49297;
  for (let i = 255; i > 0; i--) {                    // shuffle with a small seeded generator
    r = (r * 9301 + 49297) % 233280;
    const j = Math.floor((r / 233280) * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const val = (x, y) => perm[(perm[x & 255] + y) & 511] / 255;
  const noise = (x, y) => {                          // smooth value noise, 0..1
    const xi = Math.floor(x), yi = Math.floor(y);
    let fx = x - xi, fy = y - yi;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const a = val(xi, yi), b = val(xi + 1, yi), c = val(xi, yi + 1), d = val(xi + 1, yi + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  const fbm = (x, y, octaves = 5) => {
    let sum = 0, amp = 0.5, norm = 0;
    for (let i = 0; i < octaves; i++) { sum += amp * noise(x, y); norm += amp; x = x * 2.02 + 13.7; y = y * 2.02 + 7.1; amp *= 0.5; }
    return sum / norm;
  };
  return { noise, fbm };
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;

// Paints the nebula a few rows per call (so the page stays responsive); returns a function
// step() -> true when finished. Three layers, so they can move against each other:
//   gas   - the glowing cloud itself (N x N)
//   wisps - loose bright wisps and dark smoke that drift over it (N/2 x N/2, it is soft)
//   stars - the young stars in the hollow
function nebulaPainter(layers, seed) {
  const N = layers.gas.width, M = layers.wisps.width;
  const ctx = layers.gas.getContext('2d');
  const img = ctx.createImageData(N, N);
  const wispImg = layers.wisps.getContext('2d').createImageData(M, M);
  const { noise, fbm } = makeNoise(seed);
  // Colours from the inside out (0..1 RGB)
  const GREEN = [0.62, 0.8, 0.34], ORANGE = [0.93, 0.52, 0.18], RED = [0.8, 0.15, 0.12], DEEP = [0.42, 0.06, 0.08];
  const lerp3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
  let row = 0;
  return function step(rows = 32) {
    for (const end = Math.min(N, row + rows); row < end; row++) {
      for (let col = 0; col < N; col++) {
        const u = (col / N) * 2 - 1, v = (row / N) * 2 - 1;
        const wx = fbm(u * 1.8 + 3.1, v * 1.8 + 1.7, 4) - 0.5;   // warp: makes it ragged and billowy
        const wy = fbm(u * 1.8 + 8.3, v * 1.8 + 5.2, 4) - 0.5;
        const uu = u + 0.45 * wx, vv = v + 0.45 * wy;
        const r = Math.hypot(uu, vv);
        const clouds = fbm(uu * 3.2 + 1.3, vv * 3.2 + 4.1);
        const fine = fbm(uu * 9 + 7.7, vv * 9 + 2.2, 3);
        const shell = smooth(0.12, 0.42, r) * (1 - smooth(0.62, 1.0, r));
        let density = shell * (0.3 + 1.1 * Math.pow(clouds, 1.4)) * (0.75 + 0.5 * fine);
        density += 0.55 * Math.exp(-Math.pow((r - 0.37) / 0.15, 2)) * (0.3 + clouds) * (0.6 + 0.8 * fine);   // the bright rim of the hollow
        density += 0.16 * (1 - smooth(0.0, 0.42, r)) * clouds;        // a faint haze in the hollow
        density *= 0.55 + 0.9 * fbm(uu * 5 + 31.1, vv * 5 + 17.3, 4);   // wispy texture all over
        // dark dust lanes: soft and smoky, mostly in the bright ring and beyond
        const dust = smooth(0.58, 0.76, fbm(uu * 3.5 + 21.3, vv * 3.5 + 5.7, 5)) * smooth(0.3, 0.55, r);
        density *= 1 - 0.75 * dust;
        // colour by distance from the centre, jittered by noise
        const t = r + 0.18 * (clouds - 0.5);
        let c = t < 0.52 ? lerp3(GREEN, ORANGE, smooth(0.36, 0.52, t))
              : t < 0.7 ? lerp3(ORANGE, RED, smooth(0.52, 0.72, t))
              :           lerp3(RED, DEEP, smooth(0.72, 1.0, t));
        const bright = Math.min(1.3, density * (0.8 + 0.6 * clouds));
        const alpha = Math.min(0.88, bright * 0.95) * (1 - smooth(0.85, 1.0, Math.hypot(u, v)));
        const k = (row * N + col) * 4;
        const lift = 0.8 + 0.3 * bright;                           // brighter parts a little whiter
        img.data[k]     = Math.min(255, 255 * c[0] * lift);
        img.data[k + 1] = Math.min(255, 255 * c[1] * lift);
        img.data[k + 2] = Math.min(255, 255 * c[2] * lift);
        img.data[k + 3] = 255 * alpha;

        // the wisp layer, at half resolution
        if (row % 2 || col % 2) continue;
        const ring = smooth(0.12, 0.4, r) * (1 - smooth(0.7, 1.0, r)) * (1 - smooth(0.8, 0.98, Math.hypot(u, v)));
        const glow = smooth(0.55, 0.78, fbm(uu * 4.5 + 51.3, vv * 4.5 + 23.9, 4)) * ring;
        const smoke = smooth(0.58, 0.8, fbm(uu * 3.0 + 71.7, vv * 3.0 + 42.1, 4)) * ring;
        const aG = 0.38 * glow, aS = 0.5 * smoke * (1 - glow);
        const aW = aG + aS - aG * aS;
        const w = ((row / 2) * M + col / 2) * 4;
        const share = aW > 0 ? aG / aW : 0;                        // bright wisps keep the colour, smoke is dark
        wispImg.data[w]     = Math.min(255, 255 * c[0] * 1.15 * share);
        wispImg.data[w + 1] = Math.min(255, 255 * c[1] * 1.15 * share);
        wispImg.data[w + 2] = Math.min(255, 255 * c[2] * 1.15 * share);
        wispImg.data[w + 3] = 255 * aW;
      }
    }
    if (row < N) return false;
    ctx.putImageData(img, 0, 0);
    layers.wisps.getContext('2d').putImageData(wispImg, 0, 0);
    const sctx = layers.stars.getContext('2d');
    // the young stars in the hollow
    let r = seed * 7919;
    const rand = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
    for (let i = 0; i < 14; i++) {
      const a = rand() * Math.PI * 2, d = 0.04 + 0.26 * Math.sqrt(rand());
      const x = N / 2 + Math.cos(a) * d * N / 2, y = N / 2 + Math.sin(a) * d * N / 2;
      const size = (i < 4 ? 2.6 : 1.2 + rand()) * N / 640;
      sctx.beginPath();
      sctx.arc(x, y, size, 0, Math.PI * 2);
      sctx.shadowBlur = 10 * size;
      sctx.shadowColor = 'rgba(200, 225, 255, 0.9)';
      sctx.fillStyle = i % 3 ? 'rgba(235, 242, 255, 0.95)' : 'rgba(190, 215, 255, 0.95)';
      sctx.fill();
    }
    sctx.shadowBlur = 0;
    return true;
  };
}

// ---------- Drawing the nebulae: WebGL, so the gas can flow ----------
// The painted layers are only the starting picture. Every frame a shader moves them along a flow
// field: an overall slow rotation plus a random, swirling velocity field (the curl of a noise field
// that itself slowly changes, so the swirls come and go, like gas). Gas, wisps and stars each have
// their own motion. The flow is done with the "flow map" trick: two copies of a layer, each pushed
// along the field for a few seconds, cross-faded so neither is ever pushed too far out of shape.

const NEBULA_VERTEX = `
  attribute vec2 aPos;                 // the corners of a square, -1..1
  uniform vec2 uView;                  // canvas size in CSS pixels
  uniform vec2 uCenter;                // where the square goes (CSS pixels)
  uniform float uRadius;               // its half-size (CSS pixels)
  varying vec2 vP;
  void main() {
    vP = aPos;
    vec2 clip = (uCenter + aPos * uRadius) / uView * 2.0 - 1.0;
    gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  }
`;

const NEBULA_FRAGMENT = `
  precision highp float;
  uniform sampler2D uGas, uWisps, uStars;
  uniform float uMode;                 // 0 = a cloud, 1 = the glow all round when you are inside one
  uniform float uTime;                 // seconds (times the nebula's speed)
  uniform float uSeed;
  uniform float uAlpha;
  uniform float uRadius, uGlowSize;    // for the inside glow
  varying vec2 vP;

  float hash1(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float vnoise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = mix(mix(hash1(i), hash1(i + vec3(1,0,0)), f.x), mix(hash1(i + vec3(0,1,0)), hash1(i + vec3(1,1,0)), f.x), f.y);
    float b = mix(mix(hash1(i + vec3(0,0,1)), hash1(i + vec3(1,0,1)), f.x), mix(hash1(i + vec3(0,1,1)), hash1(i + vec3(1,1,1)), f.x), f.y);
    return mix(a, b, f.z);
  }
  float field(vec3 q) { return vnoise(q) + 0.5 * vnoise(q * 2.03 + 7.1); }

  // A swirling velocity field without sources or sinks (the curl of a noise "stream function"),
  // so the gas only swirls, it never piles up or empties. t slowly changes the swirls themselves.
  vec2 swirl(vec2 p, float t, float seed) {
    vec3 q = vec3(p * 1.6 + seed, t);
    const float e = 0.03;
    float dy = field(q + vec3(0.0, e, 0.0)) - field(q - vec3(0.0, e, 0.0));
    float dx = field(q + vec3(e, 0.0, 0.0)) - field(q - vec3(e, 0.0, 0.0));
    return vec2(dy, -dx) / (2.0 * e);
  }

  vec2 turn(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
  vec4 layer(sampler2D tex, vec2 p) { return texture2D(tex, p * 0.5 + 0.5); }

  // The layer pushed along velocity v: two copies, each pushed for up to "period" seconds and then
  // restarted, cross-faded so that a copy is invisible at the moment it restarts.
  vec4 flowing(sampler2D tex, vec2 p, vec2 v, float t, float period) {
    float a = fract(t / period), b = fract(t / period + 0.5);
    vec4 ca = layer(tex, p - v * a * period);
    vec4 cb = layer(tex, p - v * b * period);
    return mix(ca, cb, abs(2.0 * a - 1.0));
  }

  void main() {
    if (uMode > 0.5) {                 // inside the cloud: a soft reddish glow, stronger at the edges
      float d = length(vP) * uRadius / uGlowSize;
      vec4 c0 = vec4(0.90, 0.47, 0.20, 0.16), c1 = vec4(0.67, 0.16, 0.12, 0.20), c2 = vec4(0.35, 0.04, 0.08, 0.28);
      vec4 c = d < 0.6 ? mix(c0, c1, d / 0.6) : mix(c1, c2, clamp((d - 0.6) / 0.4, 0.0, 1.0));
      gl_FragColor = vec4(c.rgb * c.a, c.a) * uAlpha;
      return;
    }
    float t = uTime;
    // the gas: an overall slow turn, plus the random swirls
    vec2 pg = turn(vP, -0.006 * t);
    vec4 gas = flowing(uGas, pg, 0.004 * swirl(pg, 0.03 * t, uSeed), t, 8.0);
    // the wisps and smoke: turn faster (the same way) and swirl more
    vec2 pw = turn(vP, -0.011 * t);
    vec4 wisps = flowing(uWisps, pw, 0.007 * swirl(pw * 1.3, 0.05 * t, uSeed + 17.0), t + 2.5, 6.0);
    // the young stars ride along with the gas
    vec4 stars = layer(uStars, pg);
    vec4 c = gas;                      // premultiplied colours, stacked: gas, then wisps, then stars
    c = wisps + c * (1.0 - wisps.a);
    c = stars + c * (1.0 - stars.a);
    gl_FragColor = c * uAlpha;
  }
`;

// Returns { resize, clear, upload(nebula), cloud(nebula, x, y, radius, alpha, time), inside(amount) },
// or null without WebGL (then the nebulae are simply left out).
function nebulaRenderer(canvas) {
  const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false });
  if (!gl) { console.warn('starfield: no WebGL, so no nebulae'); return null; }
  const shader = (type, source) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, source);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(sh));
    return sh;
  };
  const program = gl.createProgram();
  gl.attachShader(program, shader(gl.VERTEX_SHADER, NEBULA_VERTEX));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, NEBULA_FRAGMENT));
  gl.linkProgram(program);
  gl.useProgram(program);
  const u = {};
  for (const name of ['uView', 'uCenter', 'uRadius', 'uGas', 'uWisps', 'uStars', 'uMode', 'uTime', 'uSeed', 'uAlpha', 'uGlowSize']) {
    u[name] = gl.getUniformLocation(program, name);
  }
  gl.uniform1i(u.uGas, 0);
  gl.uniform1i(u.uWisps, 1);
  gl.uniform1i(u.uStars, 2);

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);      // premultiplied alpha
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);

  const texture = picture => {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, picture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);   // outside the picture: its (empty) edge
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  };
  let view = [1, 1];

  return {
    resize(cssWidth, cssHeight, resolution) {
      const w = Math.round(cssWidth * resolution), h = Math.round(cssHeight * resolution);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      gl.viewport(0, 0, w, h);
      view = [cssWidth, cssHeight];
      gl.uniform2f(u.uView, cssWidth, cssHeight);
    },
    clear() {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    },
    upload(n) {
      n.textures = [texture(n.layers.gas), texture(n.layers.wisps), texture(n.layers.stars)];
    },
    cloud(n, x, y, radius, alpha, time) {
      n.textures.forEach((tex, i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, tex); });
      gl.uniform1f(u.uMode, 0);
      gl.uniform2f(u.uCenter, x, y);
      gl.uniform1f(u.uRadius, radius);
      gl.uniform1f(u.uAlpha, alpha);
      gl.uniform1f(u.uTime, time);
      gl.uniform1f(u.uSeed, n.seed * 3.7);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    inside(amount) {
      const size = Math.max(view[0], view[1]);
      gl.uniform1f(u.uMode, 1);
      gl.uniform2f(u.uCenter, view[0] / 2, view[1] / 2);
      gl.uniform1f(u.uRadius, size);                 // a square that covers the screen
      gl.uniform1f(u.uGlowSize, size * 0.75);
      gl.uniform1f(u.uAlpha, amount);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
  };
}

// Stellar color profiles by spectral class, with how common each one is
const STELLAR_COLORS = [
  { rgb: '130, 180, 255', weight: 0.18 },
  { rgb: '200, 225, 255', weight: 0.27 },
  { rgb: '255, 255, 255', weight: 0.25 },
  { rgb: '255, 210, 120', weight: 0.20 },
  { rgb: '255, 140, 110', weight: 0.10 },
];

function randomColor() {
  let r = Math.random();
  for (const c of STELLAR_COLORS) {
    if ((r -= c.weight) <= 0) return c.rgb;
  }
  return '255, 255, 255';
}

function generateStars(count, R) {
  return Array.from({ length: count }, () => {
    const roll = Math.random();
    const baseRadius = roll < 0.6 ? 0.8 + Math.random() * 0.9      // many faint stars
                     : roll < 0.9 ? 1.8 + Math.random() * 1.8      // some medium
                     :              4.0 + Math.random() * 3.0;     // a few bright ones
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = R * Math.cbrt(Math.random());                         // uniform in the volume
    return {
      x: r * Math.sin(phi) * Math.cos(theta),
      y: r * Math.sin(phi) * Math.sin(theta),
      z: r * Math.cos(phi),
      baseRadius,
      alpha: 0.3 + Math.random() * 0.6,
      color: randomColor(),
      isBright: baseRadius > 2.5,
    };
  });
}

// Wrap a coordinate into [-R, R)
function wrap(value, R) {
  const d = 2 * R;
  return (((value + R) % d) + d) % d - R;
}

const StarfieldPlugin = {
  id: 'starfield',

  init(deck) {
    const S = SETTINGS;
    const reveal = deck.getRevealElement();

    // Up / down: the slides inside a vertical stack get their own transition. Going down, the new
    // slide grows from far away while the old one flies past - together with the camera's flight.
    const vertical = deck.getConfig().verticalTransition;
    if (vertical) {
      for (const slide of reveal.querySelectorAll('.slides > section > section')) {
        if (!slide.hasAttribute('data-transition')) slide.setAttribute('data-transition', vertical);
      }
    }

    const canvas = document.createElement('canvas');
    canvas.className = 'starfield';                 // styled in astro.scss
    reveal.insertBefore(canvas, reveal.firstChild);
    const ctx = canvas.getContext('2d');
    // the nebulae get their own canvas underneath, at a low resolution: they are soft, and filling
    // the whole screen with them at full resolution every frame is what made the flight lag
    const nebulaCanvas = document.createElement('canvas');
    nebulaCanvas.className = 'starfield';
    reveal.insertBefore(nebulaCanvas, canvas);
    const nebulaGL = reveal.querySelector('section[data-nebula]') ? nebulaRenderer(nebulaCanvas) : null;
    let clock = 0;                                  // seconds, for the nebulae's slow motion
    const stars = generateStars(S.totalStars, S.sphereRadius);

    // Camera: position (x, z) and heading angle; "target" is where it is heading
    const cam = { x: 0, z: 0, angle: 0 };
    const target = { x: 0, z: 0, angle: 0 };

    // The camera's place on slide (h, v): turned to h * rotationStep, v forward steps along that way
    const placeFor = (h, v) => {
      const angle = h * S.rotationStep;
      return { angle, x: v * S.forwardStep * Math.sin(angle), z: v * S.forwardStep * Math.cos(angle) };
    };

    // ---- nebulae: one per <section data-nebula>, placed ahead of that slide's camera ----
    const nebulae = [...reveal.querySelectorAll('section[data-nebula]')].map(slide => {
      const d = slide.dataset;
      const { h, v } = deck.getIndices(slide);
      const place = placeFor(h, v);
      const distance = Number(d.nebulaDistance ?? 220);
      const layer = size => Object.assign(document.createElement('canvas'), { width: size, height: size });
      const layers = { gas: layer(S.nebulaPixels), wisps: layer(S.nebulaPixels / 2), stars: layer(S.nebulaPixels) };
      return {
        h, distance,
        fill: Number(d.nebulaFill ?? 1.3),
        x: place.x + distance * Math.sin(place.angle),
        z: place.z + distance * Math.cos(place.angle),
        speed: Number(d.nebulaSpeed ?? 1),           // how fast its gas moves (0 = still)
        seed: Number(d.nebulaSeed ?? 1),
        layers, paint: nebulaPainter(layers, Number(d.nebulaSeed ?? 1)), done: false,
        shown: 0,                                   // eases to 1 while you are in its stack of slides
      };
    });
    let currentH = 0;

    deck.on('ready', e => {
      const place = placeFor(e.indexh, e.indexv);
      Object.assign(cam, place);
      Object.assign(target, place);
      currentH = e.indexh;
    });

    deck.on('slidechanged', e => {
      if (!e.currentSlide || !e.previousSlide) return;
      const now = deck.getIndices(e.currentSlide);
      const before = deck.getIndices(e.previousSlide);

      currentH = now.h;
      if (now.h !== before.h) {                     // left / right: turn, to that slide's place
        Object.assign(target, placeFor(now.h, now.v));
      } else if (now.v !== before.v) {              // up / down: fly along the viewing direction
        const travel = (now.v - before.v) * S.forwardStep;
        target.x += travel * Math.sin(target.angle);
        target.z += travel * Math.cos(target.angle);
      }
    });

    let last = null;
    let drawnAt = null;                              // where the camera was when the stars were last drawn
    let nebulaWasOn = true;
    function render(time) {
      requestAnimationFrame(render);
      const dt = last === null ? 0 : Math.min((time - last) / 1000, 0.1);
      last = time;

      const k = 1 - Math.exp(-dt / S.smoothingTime);
      cam.x += (target.x - cam.x) * k;
      cam.z += (target.z - cam.z) * k;
      cam.angle += (target.angle - cam.angle) * k;

      const width = reveal.clientWidth || window.innerWidth;
      const height = reveal.clientHeight || window.innerHeight;
      if (!width || !height) return;

      const dpr = Math.min(window.devicePixelRatio || 1, S.maxPixelRatio);
      const w = Math.round(width * dpr), h = Math.round(height * dpr);
      const resized = canvas.width !== w || canvas.height !== h;
      if (resized) {
        canvas.width = w;
        canvas.height = h;
      }

      const cx = width / 2, cy = height / 2;
      const cos = Math.cos(cam.angle), sin = Math.sin(cam.angle);
      const R = S.sphereRadius;

      // Nebulae, on their own (WebGL, low-resolution) canvas underneath the stars
      clock += dt;
      let nebulaOn = false;                                   // anything to draw (or still painting)?
      for (const n of nebulae) {
        if (!n.done) { nebulaOn = true; continue; }
        n.shown += ((currentH === n.h ? 1 : 0) - n.shown) * k;
        if (n.shown >= 0.01) nebulaOn = true;
      }
      // with no nebula in view the canvas is cleared once and then left alone
      const nebulaDraw = nebulaGL && (nebulaOn || nebulaWasOn || resized);
      nebulaWasOn = nebulaOn;
      if (nebulaDraw) {
        nebulaGL.resize(width, height, S.nebulaResolution);
        nebulaGL.clear();
      }
      for (const n of nebulae) {
        if (!nebulaDraw) break;
        if (!n.done) {                                        // still being painted (a few rows a frame)
          n.done = n.paint();
          if (n.done) nebulaGL.upload(n);
          continue;
        }
        if (n.shown < 0.01) continue;
        const dx = n.x - cam.x, dz = n.z - cam.z;
        const x = dx * cos - dz * sin;
        const z = dx * sin + dz * cos;
        const D = n.distance;
        // far away: faint; on its slide: full; flying into it: it grows past you and fades
        const near = smooth(0.15 * D, 0.6 * D, z);
        const far = 1 - 0.7 * smooth(1.2 * D, 2.5 * D, z);
        if (z > 10 && near > 0.01) {
          const radius = (n.fill * height / 2) * D / z;
          nebulaGL.cloud(n, cx + x * (S.focalLength / z), cy, radius, n.shown * near * far, clock * n.speed);
        }
        // inside the cloud (the slide after it): a faint glow all round
        const inside = n.shown * smooth(0.45 * D, 0, z) * smooth(D - 1.9 * S.forwardStep, D - 1.2 * S.forwardStep, z);
        if (inside > 0.01) nebulaGL.inside(inside);
      }

      // The stars only change when the camera moves: while it rests, the last picture stays
      const still = !resized && drawnAt
        && Math.abs(cam.x - drawnAt.x) < 0.01 && Math.abs(cam.z - drawnAt.z) < 0.01
        && Math.abs(cam.angle - drawnAt.angle) < 1e-5;
      if (still) return;
      drawnAt = { x: cam.x, z: cam.z, angle: cam.angle };
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      for (const star of stars) {
        // Camera-relative coordinates, rotated into the camera frame, wrapped periodically
        const dx = star.x - cam.x, dz = star.z - cam.z;
        const x = wrap(dx * cos - dz * sin, R);
        const y = wrap(star.y, R);
        const z = wrap(dx * sin + dz * cos, R);
        if (z <= 10) continue;                      // behind the camera

        const scale = S.focalLength / z;
        const sx = cx + x * scale, sy = cy + y * scale;
        if (sx < -120 || sx > width + 120 || sy < -120 || sy > height + 120) continue;

        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(0.6, star.baseRadius * scale), 0, Math.PI * 2);
        if (star.isBright && scale > 0.2) {
          ctx.shadowBlur = S.glowBlur * scale;
          ctx.shadowColor = `rgba(${star.color}, 0.85)`;
        }
        ctx.fillStyle = `rgba(${star.color}, ${Math.min(1, Math.max(0.2, star.alpha * scale))})`;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
    requestAnimationFrame(render);
  },
};

window.StarfieldPlugin = StarfieldPlugin;
