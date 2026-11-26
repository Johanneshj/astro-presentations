// sphericalHarmonics.js
import * as THREE from 'three';

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

// ---------- The star ----------

export function createStar(container, options = {}) {
  const opts = {
    width: 500, height: 500,                     // layout size in CSS pixels
    l: 2, m: 1,
    segments: 'auto',                            // longitude segments of the mesh (latitude gets half), or 'auto'
    pulseRate: 0.5,                              // cycles per second
    pulseAmplitude: 0.1,                         // max fractional change of radius
    spinRate: 0.3,                               // radians per second (0 = no spin)
    renderScale: 1,                              // render-resolution multiplier (the plugin sets it to reveal's slide scale)
    colors: ['#1a4dff', '#ffffff', '#ff1a1a'],   // [negative, middle (nodes), positive]
    colorGamma: 0.5,                             // < 1: colors saturate faster (thinner white at nodes); 1 = linear
    colorMode: 'displacement',                   // 'displacement' | 'pattern'
    grid: false,                                 // draw latitude/longitude lines?
    gridSpacing: 30,                             // degrees; pick a divisor of 360 (10, 15, 20, 30, 45, ...)
    gridColor: '#000000',
    gridWidth: 1.5,                              // line width in CSS pixels
    gridOpacity: 0.6,                            // 0 = invisible, 1 = solid
    ...options
  };

  // Warn about misspelled option names (they would otherwise be silently ignored)
  const known = new Set(Object.keys(opts));
  for (const key of Object.keys(options)) {
    if (!known.has(key)) console.warn(`createStar: unknown option "${key}"`);
  }

  // Scene, camera, renderer
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, opts.width / opts.height, 0.1, 100);
  camera.position.set(0, 0, 4.5);

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
    },
    vertexShader: `
      uniform float uAmp;
      uniform float uEps;
      attribute float aY;
      varying float vY;
      varying vec3 vPos;
      void main() {
        vY = aY;
        vPos = position;                            // undisplaced position on the unit sphere
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
      varying float vY;
      varying vec3  vPos;

      // Anti-aliased line wherever u is an integer; fw = how much u changes per pixel
      float lineCoverage(float u, float fw) {
        float d = abs(fract(u + 0.5) - 0.5);        // distance to the nearest integer (in cells)
        float dPix = d / max(fw, 1e-6);             // the same distance, in pixels
        return clamp(0.5 * uGridWidth + 0.5 - dPix, 0.0, 1.0);
      }

      void main() {
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
  }
  applyOptions();

  const star = new THREE.Mesh(geometry, material);
  star.rotation.x = 0.4;                           // tilt the pole toward the viewer
  scene.add(star);

  // Animation loop, with start/stop so the reveal plugin can pause hidden slides
  let frameId = null;
  let phase = 0;
  let last = performance.now();

  function animate() {
    frameId = requestAnimationFrame(animate);
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;

    phase += 2 * Math.PI * opts.pulseRate * dt;
    const c = Math.cos(phase);
    material.uniforms.uAmp.value = c;
    material.uniforms.uColAmp.value = (opts.colorMode === 'pattern') ? 1.0 : c;
    star.rotation.y += opts.spinRate * dt;

    renderer.render(scene, camera);
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
      renderer.domElement.remove();
    }
  };
}