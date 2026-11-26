// sphericalHarmonics.js
import * as THREE from 'three';
import { createRayPainter, DISC as RAY_DISC } from './lib/rays.js';

// ---------- Math core ----------

/** Normalized associated Legendre function P̄_l^m(x), for 0 <= m <= l, x = cos(theta).
 *  Includes the 1/sqrt(4π) factor and the Condon–Shortley phase. */
export function legendreNorm(l, m, x) {
  // Step 1: diagonal term P_m^m, built up one factor at a time
  let pmm = Math.sqrt(1 / (4 * Math.PI));
  if (m > 0) {
    const s = Math.sqrt((1 - x) * (1 + x));        // sin(theta), stable near the poles
    for (let k = 1; k <= m; k++) {
      pmm *= -Math.sqrt((2 * k + 1) / (2 * k)) * s;
    }
  }
  if (l === m) return pmm;

  // Step 2: P_{m+1}^m
  let pPrev = pmm;
  let pCurr = Math.sqrt(2 * m + 3) * x * pmm;
  if (l === m + 1) return pCurr;

  // Step 3: climb upward in l
  for (let ll = m + 2; ll <= l; ll++) {
    const a = Math.sqrt((4 * ll * ll - 1) / (ll * ll - m * m));
    const b = Math.sqrt(((ll - 1) * (ll - 1) - m * m) / (4 * (ll - 1) * (ll - 1) - 1));
    const pNext = a * (x * pCurr - b * pPrev);
    pPrev = pCurr;
    pCurr = pNext;
  }
  return pCurr;
}

/** Real spherical harmonic Y_l^m(theta, phi). theta = colatitude, phi = longitude. */
export function realYlm(l, m, theta, phi) {
  const am = Math.abs(m);
  const p = legendreNorm(l, am, Math.cos(theta));
  if (m === 0) return p;
  return Math.SQRT2 * p * (m > 0 ? Math.cos(am * phi) : Math.sin(am * phi));
}

/** Evaluate Y_l^m once at every vertex of a three.js SphereGeometry. */
export function computeField(geometry, l, m) {
  if (!Number.isInteger(l) || !Number.isInteger(m) || l < 0 || Math.abs(m) > l) {
    throw new Error(`Invalid (l, m) = (${l}, ${m}): need integers with |m| <= l`);
  }
  const pos = geometry.attributes.position;
  const Y = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const r = Math.hypot(x, y, z);
    const theta = Math.acos(Math.max(-1, Math.min(1, y / r)));  // polar axis is y
    const phi = Math.atan2(z, -x);
    Y[i] = realYlm(l, m, theta, phi);
  }
  return Y;
}

// Load a CSS color exactly as written (our shader writes colors straight to the screen,
// so we skip three.js' sRGB -> linear conversion)
function toUniformColor(css) {
  return new THREE.Color().setStyle(css, THREE.LinearSRGBColorSpace);
}

// ---------- The cut ----------
// Two half-disc faces close the wedge cut out of the star (as in stellar.js). The inside stays still;
// only a thin outer skin of each face moves with the pulsating surface, so the rim always meets the
// surface. For that the GPU evaluates the same spherical harmonic (GLSL copy of legendreNorm / realYlm).
const SKIN = 0.12;                               // the outer part of the faces that moves, in stellar radii

const YLM_GLSL = `
  uniform int   uL;
  uniform int   uM;
  float legendreNorm(int l, int m, float x) {
    float pmm = 0.2820947918;                              // 1 / sqrt(4 pi)
    float s = sqrt(max(0.0, (1.0 - x) * (1.0 + x)));
    for (int k = 1; k <= 256; k++) {
      if (k > m) break;
      float fk = float(k);
      pmm *= -sqrt((2.0 * fk + 1.0) / (2.0 * fk)) * s;
    }
    if (l == m) return pmm;
    float pPrev = pmm;
    float pCurr = sqrt(2.0 * float(m) + 3.0) * x * pmm;
    if (l == m + 1) return pCurr;
    float fm = float(m);
    for (int i = 0; i < 256; i++) {
      int ll = m + 2 + i;
      if (ll > l) break;
      float fl = float(ll);
      float a = sqrt((4.0 * fl * fl - 1.0) / (fl * fl - fm * fm));
      float b = sqrt(((fl - 1.0) * (fl - 1.0) - fm * fm) / (4.0 * (fl - 1.0) * (fl - 1.0) - 1.0));
      float pNext = a * (x * pCurr - b * pPrev);
      pPrev = pCurr;
      pCurr = pNext;
    }
    return pCurr;
  }
  // Y_l^m at unit vector d (polar axis y, longitude atan(z, -x), as in computeField)
  float ylm(vec3 d) {
    int am = uM < 0 ? -uM : uM;
    float p = legendreNorm(uL, am, clamp(d.y, -1.0, 1.0));
    if (uM == 0) return p;
    float ph = atan(d.z, -d.x);
    return 1.4142135624 * p * (uM > 0 ? cos(float(am) * ph) : sin(float(am) * ph));
  }
`;

const FACE_VERTEX = `
  uniform float uEps;
  uniform float uAmp;
  uniform float uSpin;                 // how far the star has turned
  uniform float uFaceAngle;            // how far this face is turned about the axis
  uniform float uYNorm;                // 1 / max |Y| (as on the surface)
  varying vec2 vLocal;
  ${YLM_GLSL}
  vec3 turnY(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z); }
  void main() {
    vLocal = position.xy;              // the face: a half disc (x >= 0, y = the axis), radius 1
    float r = length(position);
    float grow = 1.0;
    if (r > 1e-4) {
      vec3 d = turnY(turnY(position / r, uFaceAngle), -uSpin);   // that direction, in the star's own frame
      // the surface's displacement, faded in over the outer skin (inside it nothing moves)
      grow = 1.0 + uEps * uAmp * ylm(d) * uYNorm * smoothstep(${(1 - SKIN).toFixed(3)}, 1.0, r) / r;
    }
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position * grow, 1.0);
  }
`;

const FACE_FRAGMENT = `
  uniform vec3  uColor;
  uniform float uShade;                // the two faces differ a little, so they read as 3D
  uniform float uSide;                 // -1 = left face, 1 = right: together they make one disc
  uniform float uRaysOn;
  uniform sampler2D uRayTex;
  varying vec2 vLocal;
  void main() {
    float r = length(vLocal);
    vec3 col = mix(uColor, vec3(1.0), 0.35 * (1.0 - r) * (1.0 - r));    // a little lighter towards the centre
    if (uRaysOn > 0.5) {
      vec4 ray = texture2D(uRayTex, vec2(uSide * vLocal.x, vLocal.y) * ${(0.5 * RAY_DISC).toFixed(4)} + 0.5);
      col = mix(col, ray.rgb, ray.a);
    }
    gl_FragColor = vec4(col * uShade, 1.0);
  }
`;

// ---------- The star ----------

// Camera distance, in star radii. The field of view follows from `fill`.
const DISTANCE = 4.5;
const outline = r => Math.tan(Math.asin(r / DISTANCE));   // a sphere of radius r, seen in perspective

/** The fill (fraction of the canvas the star at rest covers) at which the star, swelling to
 *  1 + amplitude, still fits with a small margin. */
export function fillFor(amplitude, margin = 1.04) {
  return outline(1) / (outline(1 + amplitude) * margin);
}

export function createStar(container, options = {}) {
  const opts = {
    width: 500, height: 500,                     // layout size in CSS pixels
    l: 2, m: 1,
    segments: 'auto',                            // longitude segments of the mesh (latitude gets half), or 'auto'
    pulseRate: 0.5,                              // cycles per second
    pulseAmplitude: 0.1,                         // max fractional change of radius
    fill: null,                                  // fraction of the canvas the star at rest covers; null = fits the pulsation
    spinRate: 0.3,                               // radians per second (0 = no spin)
    still: false,                                // true = starts at rest (a plain round sphere, not turning)
                                                 // until setPulsing(true)
    rampTime: 1,                                 // seconds to get going / come to rest
    renderScale: 1,                              // render-resolution multiplier (the plugin sets it to reveal's slide scale)
    colors: ['#ff1a1a', '#ffffff', '#1a4dff'],   // [negative, middle (nodes), positive]: with 'velocity',
                                                 // moving in = red, moving out = blue (like a Doppler shift)
    colorGamma: 1,                               // 1 = smooth; > 1 = wider, softer white nodal bands;
                                                 // < 1 = thinner bands but a sharp crease at every node
    colorMode: 'velocity',                       // 'velocity' (colors follow the surface's motion in / out),
                                                 // 'displacement' (pushed out / pulled in) | 'pattern' (fixed)
    grid: false,                                 // draw latitude/longitude lines?
    gridSpacing: 30,                             // degrees; pick a divisor of 360 (10, 15, 20, 30, 45, ...)
    gridColor: '#000000',
    gridWidth: 1.5,                              // line width in CSS pixels
    gridOpacity: 0.6,                            // 0 = invisible, 1 = solid
    cut: false,                                  // can be cut open (a wedge removed, facing the viewer)
    cutOpen: false,                              // already open at the start
    cutAngle: 90,                                // opening of the wedge, degrees
    cutDuration: 1.5,                            // seconds to open / close
    cutColor: '#f3e7d3',                         // the inside
    rays: null,                                  // acoustic rays inside: degrees l to trace; null = this mode's l; [] = none
    rayFrequencies: [1],                         // each mode's frequency in units of the pulsation rate (one value = all)
    rayOmega: 25,                                // the pulsation rate's angular frequency in the rays' units
                                                 // (core sound speed / radius): sets how deep a ray of given l dives
    rayTrail: 0.8,                               // trail length, as a fraction of a ray's time round the star
    raySpeed: 1,                                 // how fast the wave travels along its ray
    rayColors: null,                             // one per mode; null = the default palette
    rayWidth: 1,                                 // line width (1 = default)
    rayLoop: 0,                                  // seconds: the rays repeat exactly after this time (for looping animations; 0 = off)
    ...options
  };

  // Warn about misspelled option names (they would otherwise be silently ignored)
  const known = new Set(Object.keys(opts));
  for (const key of Object.keys(options)) {
    if (!known.has(key)) console.warn(`createStar: unknown option "${key}"`);
  }

  // Scene, camera, renderer
  const scene = new THREE.Scene();
  const fill = opts.fill ?? fillFor(opts.pulseAmplitude);
  const fov = 2 * Math.atan(outline(1) / fill) * 180 / Math.PI;
  const camera = new THREE.PerspectiveCamera(fov, opts.width / opts.height, 0.1, 100);
  camera.position.set(0, 0, DISTANCE);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(opts.width, opts.height);     // also pins the canvas' CSS size to width x height
  container.appendChild(renderer.domElement);

  // Mesh: fine enough for the pattern (about 6 vertices per half-wavelength), capped for speed
  const W = (opts.segments === 'auto')
    ? Math.min(1024, Math.max(256, 12 * opts.l))
    : opts.segments;
  const geometry = new THREE.SphereGeometry(1, W, Math.round(W / 2));

  // Evaluate Y once, normalise to [-1, 1], hand to the GPU
  const Y = computeField(geometry, opts.l, opts.m);
  let maxAbs = 0;
  for (const v of Y) maxAbs = Math.max(maxAbs, Math.abs(v));
  for (let i = 0; i < Y.length; i++) Y[i] /= maxAbs;
  geometry.setAttribute('aY', new THREE.BufferAttribute(Y, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uAmp:         { value: 1.0 },                 // cos(ωt): drives the displacement
      uColAmp:      { value: 1.0 },                 // drives the colors (cos ωt, or 1 in 'pattern' mode)
      uColorGamma:  { value: 1.0 },
      uEps:         { value: 0.0 },                 // ε (filled in by applyOptions)
      uColNeg:      { value: new THREE.Color() },
      uColMid:      { value: new THREE.Color() },
      uColPos:      { value: new THREE.Color() },
      uGridOn:      { value: 0.0 },
      uGridSpacing: { value: 0.5 },                 // radians
      uGridColor:   { value: new THREE.Color() },
      uGridWidth:   { value: 1.0 },                 // device pixels
      uGridOpacity: { value: 0.5 },
      uSpin:        { value: 0.0 },                 // how far the star has turned (the cut does not turn)
      uCutHalf:     { value: 0.0 },                 // half the wedge's opening, radians (0 = closed)
    },
    vertexShader: `
      uniform float uAmp;
      uniform float uEps;
      uniform float uSpin;
      attribute float aY;
      varying float vY;
      varying vec3 vPos;
      varying vec3 vFixed;
      void main() {
        vY = aY;
        vPos = position;                            // undisplaced position on the unit sphere
        float c = cos(uSpin), s = sin(uSpin);
        vFixed = vec3(c * position.x + s * position.z, position.y, -s * position.x + c * position.z);   // not turning
        vec3 displaced = position * (1.0 + uEps * aY * uAmp);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uColAmp;
      uniform float uColorGamma;
      uniform vec3  uColNeg;
      uniform vec3  uColMid;
      uniform vec3  uColPos;
      uniform float uGridOn;
      uniform float uGridSpacing;
      uniform vec3  uGridColor;
      uniform float uGridWidth;
      uniform float uGridOpacity;
      uniform float uCutHalf;
      varying float vY;
      varying vec3  vPos;
      varying vec3  vFixed;

      // Anti-aliased line wherever u is an integer; fw = how much u changes per pixel
      float lineCoverage(float u, float fw) {
        float d = abs(fract(u + 0.5) - 0.5);        // distance to the nearest integer (in cells)
        float dPix = d / max(fw, 1e-6);             // the same distance, in pixels
        return clamp(0.5 * uGridWidth + 0.5 - dPix, 0.0, 1.0);
      }

      void main() {
        // the wedge cut out, facing the viewer: the faces behind show through
        if (uCutHalf > 0.001 && abs(atan(vFixed.x, vFixed.z)) < uCutHalf) discard;

        // --- colormap ---
        float s = clamp(vY * uColAmp, -1.0, 1.0);
        s = sign(s) * pow(abs(s), uColorGamma);
        vec3 target = (s > 0.0) ? uColPos : uColNeg;
        vec3 col = mix(uColMid, target, abs(s));

        // --- optional grid ---
        if (uGridOn > 0.5) {
          vec3 p = normalize(vPos);
          float lat  = asin(clamp(p.y, -1.0, 1.0));
          float latU = lat / uGridSpacing;

          // atan() jumps at its seam, which would ruin fwidth() there. A second atan()
          // with a different seam lets us take whichever derivative is well behaved.
          float lonA = atan(p.z, -p.x);
          float lonB = atan(-p.z, p.x);
          float lonU = lonA / uGridSpacing;
          float fwLon = min(fwidth(lonA), fwidth(lonB)) / uGridSpacing;

          float aLat = lineCoverage(latU, fwidth(latU));
          float aLon = lineCoverage(lonU, fwLon) * (1.0 - smoothstep(0.15, 0.4, fwLon)); // fade near poles
          col = mix(col, uGridColor, max(aLat, aLon) * uGridOpacity);
        }

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  let cutReady = false;                            // the cut (below) is set up after the first applyOptions()

  // Push the current options into the renderer and the shader uniforms
  function applyOptions() {
    // Render resolution: display pixel ratio x slide scale, capped at a 4096-pixel buffer
    const ratio = Math.min(window.devicePixelRatio * opts.renderScale,
                           4096 / Math.max(opts.width, opts.height));
    if (renderer.getPixelRatio() !== ratio) renderer.setPixelRatio(ratio);

    const u = material.uniforms;
    u.uEps.value = opts.pulseAmplitude;
    if (opts.colors.length !== 3) throw new Error('createStar: "colors" needs exactly 3 entries');
    u.uColNeg.value = toUniformColor(opts.colors[0]);
    u.uColMid.value = toUniformColor(opts.colors[1]);
    u.uColPos.value = toUniformColor(opts.colors[2]);
    u.uColorGamma.value = Math.max(0.05, opts.colorGamma);   // gamma must stay > 0
    u.uGridOn.value = opts.grid ? 1.0 : 0.0;
    u.uGridSpacing.value = opts.gridSpacing * Math.PI / 180;
    u.uGridColor.value = toUniformColor(opts.gridColor);
    u.uGridWidth.value = opts.gridWidth * renderer.getPixelRatio();
    u.uGridOpacity.value = opts.gridOpacity;
    if (cutReady) applyCutOptions();
  }
  applyOptions();

  // tilted: the pole leans toward the viewer; spinner: turns the star about its axis; the cut faces sit
  // in the tilted frame, so the opening keeps facing the viewer while the star turns
  const tilted = new THREE.Group();
  tilted.rotation.x = 0.4;
  scene.add(tilted);
  const spinner = new THREE.Group();
  tilted.add(spinner);
  const star = new THREE.Mesh(geometry, material);
  spinner.add(star);

  // ---- the cut ----
  const faceUniforms = {                           // shared by both faces (uAmp, uEps, uSpin: the surface's own)
    uAmp: material.uniforms.uAmp,
    uEps: material.uniforms.uEps,
    uSpin: material.uniforms.uSpin,
    uL: { value: opts.l },
    uM: { value: opts.m },
    uYNorm: { value: 1 / maxAbs },
    uColor: { value: new THREE.Color() },
    uRaysOn: { value: 0 },
    uRayTex: { value: null },
  };
  // the x >= 0 half disc, with rings, so the skin can move while the inside stays put
  const faceGeometry = new THREE.RingGeometry(0, 1, Math.max(192, 8 * opts.l), Math.ceil(3 / SKIN), -Math.PI / 2, Math.PI);
  const makeFace = (shade, side) => new THREE.Mesh(faceGeometry, new THREE.ShaderMaterial({
    uniforms: { ...faceUniforms, uShade: { value: shade }, uSide: { value: side }, uFaceAngle: { value: 0 } },
    vertexShader: FACE_VERTEX,
    fragmentShader: FACE_FRAGMENT,
    side: THREE.DoubleSide,
  }));
  const faces = [makeFace(1.0, -1), makeFace(0.85, 1)];   // left, right
  const cutGroup = new THREE.Group();
  cutGroup.add(...faces);
  tilted.add(cutGroup);

  let cutProgress = opts.cut && opts.cutOpen ? 1 : 0;     // 0 = closed, 1 = open
  let cutTarget = cutProgress;
  function applyCut() {
    const open = cutProgress * cutProgress * (3 - 2 * cutProgress);
    const half = 0.5 * open * Math.min(180, Math.max(0, opts.cutAngle)) * Math.PI / 180;
    const on = opts.cut && half > 0.005;
    material.uniforms.uCutHalf.value = on ? half : 0;
    faces[0].material.uniforms.uFaceAngle.value = -half - Math.PI / 2;   // turns the half disc's +x onto azimuth -half
    faces[1].material.uniforms.uFaceAngle.value = half - Math.PI / 2;
    faces.forEach(f => { f.rotation.y = f.material.uniforms.uFaceAngle.value; });
    cutGroup.visible = on;
  }

  // ---- acoustic rays inside ----
  const modes = (opts.rays ?? [opts.l]).map(Number).filter(Number.isFinite);
  const rays = opts.cut && modes.length ? createRayPainter({
    modes, frequencies: [].concat(opts.rayFrequencies ?? 1).map(Number), omega: opts.rayOmega, trail: opts.rayTrail, speed: opts.raySpeed, width: opts.rayWidth, loop: opts.rayLoop,
    ...(opts.rayColors ? { colors: opts.rayColors } : {}),
  }) : null;
  let rayTexture = null, rayClock = 0;
  if (rays) {
    rayTexture = new THREE.CanvasTexture(rays.canvas);
    rayTexture.colorSpace = THREE.NoColorSpace;    // colors exactly as written
    rayTexture.generateMipmaps = false;
    rayTexture.minFilter = THREE.LinearFilter;
    faceUniforms.uRayTex.value = rayTexture;
    faceUniforms.uRaysOn.value = 1;
  }
  function applyCutOptions() {
    faceUniforms.uColor.value = toUniformColor(opts.cutColor);
    rays?.setSize(opts.width * fill * renderer.getPixelRatio() / RAY_DISC);   // about one texel per pixel
    applyCut();
  }
  cutReady = true;
  applyCutOptions();

  // Animation loop, with start/stop so the reveal plugin can pause hidden slides
  let frameId = null;
  let phase = 0;
  let last = performance.now();
  // How much it moves: 0 = at rest (equilibrium: round, not turning), 1 = full pulsation and spin.
  // It eases towards motionTarget, so starting and stopping are smooth.
  let motion = opts.still ? 0 : 1;
  let motionTarget = motion;

  function animate() {
    frameId = requestAnimationFrame(animate);
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;

    if (motion !== motionTarget) {
      const step = dt / Math.max(0.01, opts.rampTime);
      motion = motionTarget > motion ? Math.min(motionTarget, motion + step) : Math.max(motionTarget, motion - step);
    }
    const ease = motion * motion * (3 - 2 * motion);
    phase += 2 * Math.PI * opts.pulseRate * dt;
    spinner.rotation.y += opts.spinRate * dt * ease;
    material.uniforms.uSpin.value = spinner.rotation.y;

    // opening / closing; the rays travel while it is open and start again each time it opens
    if (cutProgress !== cutTarget) {
      const step = dt / Math.max(0.01, opts.cutDuration);
      cutProgress = cutTarget > cutProgress ? Math.min(cutTarget, cutProgress + step) : Math.max(cutTarget, cutProgress - step);
      applyCut();
    }
    if (rays) {
      if (cutGroup.visible) {
        rayClock += dt;
        rays.draw(rayClock);
        rayTexture.needsUpdate = true;
      } else rayClock = 0;
    }
    draw(ease);
  }

  // Set the shape for the current phase, scaled by how much it moves (0 = at rest), and render
  function draw(ease) {
    const c = Math.cos(phase) * ease;
    material.uniforms.uAmp.value = c;
    // velocity: d/dt cos(phase) = -sin(phase), a quarter period ahead of the displacement
    material.uniforms.uColAmp.value = opts.colorMode === 'pattern' ? ease
      : opts.colorMode === 'displacement' ? c
      : -Math.sin(phase) * ease;
    renderer.render(scene, camera);
  }

  // Start pulsing (true) or come to rest (false); snap = at once instead of easing
  function setPulsing(on, snap = false) {
    motionTarget = on ? 1 : 0;
    if (snap || frameId === null) {
      motion = motionTarget;
      draw(motion);
    }
  }

  function start() {
    if (frameId !== null) return;      // already running
    last = performance.now();          // so the time spent paused doesn't count as elapsed
    animate();
  }

  function stop() {
    if (frameId === null) return;
    cancelAnimationFrame(frameId);
    frameId = null;
  }

  start();

  return {
    start,
    stop,
    setPulsing,                        // setPulsing(true / false, snap): start pulsing / come to rest
    get pulsing() { return motionTarget === 1; },
    // the cut: open / close it (animated), or snap it open / closed at once
    openCut() { cutTarget = 1; },
    closeCut() { cutTarget = 0; },
    snapCut(open) {
      cutProgress = cutTarget = open ? 1 : 0;
      applyCut();
      if (frameId === null) draw(motion);
    },
    // change any option except l, m, segments, width, height while it runs
    set(newOpts) {
      Object.assign(opts, newOpts);
      applyOptions();
      if (frameId === null) renderer.render(scene, camera);   // paused: redraw once
    },
    dispose() {
      stop();
      renderer.dispose();
      geometry.dispose();
      material.dispose();
      faceGeometry.dispose();
      faces.forEach(f => f.material.dispose());
      rayTexture?.dispose();
      renderer.domElement.remove();
    }
  };
}