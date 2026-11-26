// js_routines/stellar.js
// A rotating, glowing star with optional surface textures and an optional cutaway that shows the
// interior zones with animated arrows. Orthographic view: the canvas spans y = -1 .. +1 and
// x = -aspect .. +aspect; the star's radius is given in those units.
import * as THREE from 'three';

const MAX_SPOTS = 24;   // must match MAX_SPOTS in the surface shader
const MAX_ZONES = 6;    // must match MAX_ZONES in the cut-face shader

// Shape of the interior arrows. Lengths are in stellar radii (1 = the star's radius).
const ARROW_STYLE = {
  lineWidth:    0.018,  // stroke width
  headLength:   0.05,   // arrowhead length (smaller in thin zones and small loops)
  wiggleLength: 0.07,   // wavelength of the radiative wiggle
  wiggleAmp:    0.018,  // amplitude of the radiative wiggle
  wiggleSpeed:  0.08,   // how fast the wiggle travels outward, radii per second
  cellFraction: 0.36,   // convective cell radius as a fraction of the zone's thickness
  cellMax:      0.2,    // ... but never larger than this
  cellGap:      2.4,    // distance between neighbouring cell centres, in cell radii
  loopFraction: 0.75,   // loop arrow radius / cell radius
  loopArc:      1.55,   // how much of a circle a loop arrow covers, in units of pi
  loopSpeed:    0.8,    // how fast the loops turn, radians per second
};

// Load a CSS color exactly as written (our shaders write colors straight to the screen,
// so we skip three.js' sRGB -> linear conversion)
function toUniformColor(css) {
  return new THREE.Color().setStyle(css, THREE.LinearSRGBColorSpace);
}

/** Approximate color of a blackbody of temperature T (kelvin), as a CSS string (Tanner Helland's fit,
 *  good for 1000-40000 K). Meant for visualisation, not for colorimetry. */
export function temperatureToColor(T) {
  const t = Math.min(40000, Math.max(1000, T)) / 100;
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661
                    : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : (t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307);
  const c = v => Math.round(Math.min(255, Math.max(0, v)));
  return `rgb(${c(r)}, ${c(g)}, ${c(b)})`;
}

/** Small seeded random number generator, so the same seed always gives the same spots. */
function mulberry32(seed) {
  let a = seed | 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random spots in a latitude band: [x, y, z, angular radius in radians], with (x, y, z) a unit vector. */
function makeSpots(count, sizeDeg, maxLatDeg, seed) {
  const rand = mulberry32(seed);
  const spots = [];
  for (let i = 0; i < count; i++) {
    const lat = (rand() * 2 - 1) * maxLatDeg * Math.PI / 180;
    const lon = rand() * 2 * Math.PI;
    const r = sizeDeg * Math.PI / 180 * (0.6 + 0.8 * rand());      // spots differ in size by +-40 %
    spots.push([Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon), r]);
  }
  return spots;
}

// What each texture preset means: granulation strength (0..1) and number of spots
const PRESETS = {
  none:        { granulation: 0, spots: 0 },
  granulation: { granulation: 1, spots: 0 },
  spots:       { granulation: 0, spots: 6 },
  both:        { granulation: 0.8, spots: 6 },
};

// Interior structures, from the centre outward: [zone type, outer edge as r/R].
// Cartoon values: good enough to show the idea, not taken from a stellar model.
const STRUCTURES = {
  sun:         [['radiative', 0.71], ['convective', 1]],   // radiative core + radiative zone, convective envelope
  'red-giant': [['radiative', 0.12], ['convective', 1]],   // tiny core, deep convective envelope
  massive:     [['convective', 0.25], ['radiative', 1]],   // convective core, radiative envelope
  dwarf:       [['convective', 1]],                        // red dwarf: convective all the way through
};

/** Turn a zone list into [{ convective, to }] with increasing edges and the last edge at 1.
 *  Accepts an array like [['radiative', 0.71], ['convective', 1]] or a string like
 *  "radiative:0.71, convective:1" (the type may be shortened to r / c). */
function parseZones(zones) {
  const list = typeof zones === 'string'
    ? zones.split(',').map(s => s.split(':').map(t => t.trim()))
    : zones;
  const out = [];
  for (const [type, edge] of list) {
    const t = String(type).toLowerCase();
    if (!t.startsWith('r') && !t.startsWith('c')) {
      console.warn(`createStellar: unknown zone type "${type}" (use radiative or convective)`);
      continue;
    }
    const to = edge === undefined || edge === '' ? 1 : Number(edge);
    if (!(to > 0 && to <= 1) || (out.length && to <= out[out.length - 1].to)) {
      console.warn(`createStellar: zone edge ${edge} skipped (edges must increase, between 0 and 1)`);
      continue;
    }
    out.push({ convective: t.startsWith('c'), to });
  }
  if (out.length === 0) out.push({ convective: false, to: 1 });
  if (out.length > MAX_ZONES) {
    console.warn(`createStellar: at most ${MAX_ZONES} zones; the rest are dropped`);
    out.length = MAX_ZONES;
  }
  out[out.length - 1].to = 1;                              // the outermost zone always reaches the surface
  return out;
}

const glslFloat = v => Number(v).toFixed(5);               // GLSL needs "2.00000", not "2"

// ---------- Shaders ----------

const SURFACE_VERTEX = `
  uniform float uSpin;        // the star's current rotation angle about its axis
  varying vec3 vNormalView;   // surface normal in view space (z points at the viewer)
  varying vec3 vObj;          // position on the unit sphere; it turns with the star
  varying vec3 vPiv;          // the same point in the tilted but non-spinning frame (the cut lives here)
  void main() {
    vObj = position;
    float c = cos(uSpin), s = sin(uSpin);                  // same rotation as three.js' rotation.y
    vPiv = vec3(c * position.x + s * position.z, position.y, -s * position.x + c * position.z);
    vNormalView = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SURFACE_FRAGMENT = `
  #define MAX_SPOTS ${MAX_SPOTS}

  uniform vec3  uColor;
  uniform float uLimb;
  uniform float uTime;                 // seconds of "boiling"
  uniform float uGran;                 // granulation strength, 0 = off
  uniform float uGranScale;            // cells across the radius
  uniform int   uSpotCount;
  uniform vec4  uSpots[MAX_SPOTS];     // xyz = direction on the unit sphere, w = angular radius (radians)
  uniform float uGridOn;
  uniform float uGridSpacing;
  uniform float uGridWidth;
  uniform float uCutOn;                // 1 = a wedge is removed
  uniform vec3  uCutN1;                // the wedge = points on the positive side of both planes
  uniform vec3  uCutN2;
  varying vec3 vNormalView;
  varying vec3 vObj;
  varying vec3 vPiv;

  // ---- noise helpers (cartoon-grade: pseudo-random numbers from sin) ----
  float hash1(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
  }
  vec3 hash3(vec3 p) {
    vec3 q = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
                  dot(p, vec3(269.5, 183.3, 246.1)),
                  dot(p, vec3(113.5, 271.9, 124.6)));
    return fract(sin(q) * 43758.5453123);
  }

  // Smooth value noise in 3D (used to make the spot outlines wobbly)
  float vnoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = mix(mix(hash1(i),                    hash1(i + vec3(1,0,0)), f.x),
                  mix(hash1(i + vec3(0,1,0)),      hash1(i + vec3(1,1,0)), f.x), f.y);
    float b = mix(mix(hash1(i + vec3(0,0,1)),      hash1(i + vec3(1,0,1)), f.x),
                  mix(hash1(i + vec3(0,1,1)),      hash1(i + vec3(1,1,1)), f.x), f.y);
    return mix(a, b, f.z);
  }

  // Cell pattern: x = distance to the nearest cell centre, y = distance to the second nearest,
  // z = a random number per cell. The centres wander slowly with time, so the cells "boil".
  vec3 voronoi(vec3 x, float t) {
    vec3 n = floor(x);
    vec3 f = fract(x);
    float F1 = 8.0;
    float F2 = 8.0;
    float cellId = 0.0;
    for (int k = -1; k <= 1; k++) {
      for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
          vec3 g = vec3(float(i), float(j), float(k));
          vec3 h = hash3(n + g);
          vec3 pt = g + 0.5 + 0.45 * sin(t * (0.3 + 0.7 * h) + 6.2831 * h);
          float d = length(pt - f);
          if (d < F1) { F2 = F1; F1 = d; cellId = h.x; }
          else if (d < F2) { F2 = d; }
        }
      }
    }
    return vec3(F1, F2, cellId);
  }

  // Anti-aliased line wherever u is an integer; fw = how much u changes per pixel
  float lineCoverage(float u, float fw) {
    float d = abs(fract(u + 0.5) - 0.5);
    float dPix = d / max(fw, 1e-6);
    return clamp(0.5 * uGridWidth + 0.5 - dPix, 0.0, 1.0);
  }

  void main() {
    // Inside the removed wedge: draw nothing, so the cut faces behind show through
    if (uCutOn > 0.5 && dot(vPiv, uCutN1) > 0.0 && dot(vPiv, uCutN2) > 0.0) discard;

    vec3 p = normalize(vObj);                              // where on the star's surface we are
    float mu = clamp(vNormalView.z, 0.0, 1.0);             // cosine of the angle from the line of sight
    float limb = 1.0 - uLimb * (1.0 - mu);                 // limb darkening: I(mu) = 1 - u (1 - mu)

    // ---- surface texture: a brightness factor, 1 = untouched ----
    float tex = 1.0;

    if (uGran > 0.001) {                                   // convective granulation
      vec3 v = voronoi(p * uGranScale, uTime);
      float lane = smoothstep(0.02, 0.22, v.y - v.x);      // 0 in the dark lanes between cells, 1 inside a granule
      tex *= 1.15 - uGran * (1.0 - lane) * 0.5 + uGran * 0.12 * (v.z - 0.5);
    }

    if (uSpotCount > 0) {                                  // dark spots
      float wobble = vnoise(p * 40.0) - 0.5;               // makes the outlines irregular
      for (int i = 0; i < MAX_SPOTS; i++) {
        if (i >= uSpotCount) break;
        float r = uSpots[i].w;
        float c = dot(p, uSpots[i].xyz);
        if (c < cos(1.25 * r)) continue;                   // far from this spot: skip the expensive part
        float d = acos(clamp(c, -1.0, 1.0)) + 0.25 * r * wobble;
        float umbra = mix(0.12, 0.55, smoothstep(0.45 * r, 0.6 * r, d));   // very dark core, lighter rim
        tex *= mix(umbra, 1.0, smoothstep(0.9 * r, 1.0 * r, d));           // fade out to the normal surface
      }
    }

    vec3 col = mix(uColor, vec3(1.0), 0.25 * mu * mu) * limb * tex;   // slightly whiter at the centre

    if (uGridOn > 0.5) {
      float latU = asin(clamp(p.y, -1.0, 1.0)) / uGridSpacing;
      // atan() jumps at its seam, which would ruin fwidth() there; a second atan() has its seam elsewhere
      float lonA = atan(p.z, -p.x);
      float lonB = atan(-p.z, p.x);
      float lonU = lonA / uGridSpacing;
      float fwLon = min(fwidth(lonA), fwidth(lonB)) / uGridSpacing;
      float aLat = lineCoverage(latU, fwidth(latU));
      float aLon = lineCoverage(lonU, fwLon) * (1.0 - smoothstep(0.15, 0.4, fwLon));   // fade near the poles
      col = mix(col, vec3(0.0), 0.35 * max(aLat, aLon));
    }

    gl_FragColor = vec4(col, 1.0);
  }
`;

// The two flat faces of the cut. Each is a half disc of radius 1 in its own xy plane (x >= 0), so
// the distance from the star's centre (in stellar radii) is simply length(position.xy).
const FACE_VERTEX = `
  varying vec2 vLocal;
  void main() {
    vLocal = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FACE_FRAGMENT = `
  #define MAX_ZONES ${MAX_ZONES}
  #define PI 3.14159265

  // Arrow shapes (from ARROW_STYLE in stellar.js)
  #define LINE_W        ${glslFloat(ARROW_STYLE.lineWidth)}
  #define HEAD_LEN      ${glslFloat(ARROW_STYLE.headLength)}
  #define WIGGLE_LEN    ${glslFloat(ARROW_STYLE.wiggleLength)}
  #define WIGGLE_AMP    ${glslFloat(ARROW_STYLE.wiggleAmp)}
  #define WIGGLE_SPEED  ${glslFloat(ARROW_STYLE.wiggleSpeed)}
  #define CELL_FRAC     ${glslFloat(ARROW_STYLE.cellFraction)}
  #define CELL_MAX      ${glslFloat(ARROW_STYLE.cellMax)}
  #define CELL_GAP      ${glslFloat(ARROW_STYLE.cellGap)}
  #define LOOP_FRAC     ${glslFloat(ARROW_STYLE.loopFraction)}
  #define LOOP_ARC      ${glslFloat(ARROW_STYLE.loopArc)}
  #define LOOP_SPEED    ${glslFloat(ARROW_STYLE.loopSpeed)}

  uniform vec3  uRadColor;             // color of radiative zones
  uniform vec3  uConvColor;            // color of convective zones
  uniform int   uZoneCount;
  uniform float uZoneTo[MAX_ZONES];    // outer edge of each zone, r/R
  uniform float uZoneConv[MAX_ZONES];  // 1 = convective, 0 = radiative
  uniform float uCentreWhite;          // how much whiter (hotter-looking) the centre is
  uniform float uLineWidth;            // boundary line width in device pixels
  uniform float uShade;                // the two faces get slightly different brightness, so they read as 3D
  uniform float uArrowsOn;
  uniform float uArrowTime;            // seconds of arrow animation
  uniform vec3  uArrowColor;
  uniform float uArrowOpacity;
  uniform int   uRays;                 // radiative arrows per face
  varying vec2 vLocal;

  // The arrows are drawn as "signed distances": d < 0 inside the shape, d > 0 outside,
  // in stellar radii. coverage() turns that into a smooth (anti-aliased) 0..1 edge.
  float coverage(float d, float px) { return clamp(0.5 - d / px, 0.0, 1.0); }

  // Arrowhead: a triangle with its base at along = 0 and its tip at along = h, half width hw at the base
  float headDist(float along, float side, float h, float hw) {
    float edge = (abs(side) - hw * (1.0 - along / h)) / sqrt(1.0 + (hw / h) * (hw / h));
    return max(max(-along, along - h), edge);
  }

  // Radiative zone: a wiggly arrow pointing outward along the nearest of uRays rays
  float radiativeArrow(vec2 p, float r0, float r1) {
    float w = r1 - r0;
    float h = min(HEAD_LEN, 0.25 * w);
    float a0 = r0 + (r0 < 0.001 ? 0.25 : 0.12) * w;       // start (further out near the centre, where rays crowd)
    float a1 = r1 - 0.12 * w - h;                          // end of the shaft = base of the head
    if (a1 <= a0) return 1.0;                              // zone too thin for an arrow

    // Pick the nearest ray and measure along it (a) and across it (b)
    float N = float(uRays);
    float th = atan(p.y, p.x);                             // -pi/2 .. pi/2 on the half disc
    float k = clamp(floor((th + 0.5 * PI) / (PI / N)), 0.0, N - 1.0);
    float thk = -0.5 * PI + (k + 0.5) * PI / N;
    vec2 dir = vec2(cos(thk), sin(thk));
    float a = dot(p, dir);
    float b = dot(p, vec2(-dir.y, dir.x));

    // Shaft: b = f(a), a sine whose crests travel outward, faded to zero at both ends
    float s = clamp((a - a0) / (a1 - a0), 0.0, 1.0);
    float amp = min(WIGGLE_AMP, 0.1 * w) * sin(PI * s);
    float kk = 2.0 * PI / WIGGLE_LEN;
    float ph = kk * (a - WIGGLE_SPEED * uArrowTime);
    float f = amp * sin(ph);
    float df = amp * kk * cos(ph);
    float dShaft = abs(b - f) / sqrt(1.0 + df * df) - 0.5 * LINE_W;
    dShaft = max(dShaft, max(a0 - a, a - a1));             // only between a0 and a1

    return min(dShaft, headDist(a - a1, b, h, 0.6 * h));
  }

  // Convective zone: a row of cells along the middle of the zone, each with a turning loop arrow.
  // Neighbouring cells turn in opposite directions. "cell" returns 0..1 for the faint shading.
  float convectiveArrow(vec2 p, float r0, float r1, out float cell) {
    float w = r1 - r0;
    float rm = 0.5 * (r0 + r1);
    float rc = min(CELL_FRAC * w, CELL_MAX);
    float n = max(1.0, floor(PI * rm / (CELL_GAP * rc)));  // how many cells fit along the half circle

    float th = atan(p.y, p.x);
    float j = clamp(floor((th + 0.5 * PI) / (PI / n)), 0.0, n - 1.0);
    float thj = -0.5 * PI + (j + 0.5) * PI / n;
    vec2 c = rm * vec2(cos(thj), sin(thj));                // centre of the nearest cell
    float spin = mod(j, 2.0) < 0.5 ? 1.0 : -1.0;

    vec2 q = p - c;
    float rho = length(q);
    cell = 1.0 - smoothstep(0.85 * rc, rc, rho);

    // The loop: a ring of radius rl, kept only over an arc of LOOP_ARC * pi that turns with time
    float rl = LOOP_FRAC * rc;
    float arc = LOOP_ARC * PI;
    float start = spin * LOOP_SPEED * uArrowTime;
    float rel = mod(spin * (atan(q.y, q.x) - start), 2.0 * PI);   // angle from the arc's start, along the spin
    float dRing = abs(rho - rl) - 0.5 * LINE_W;
    if (rel > arc) dRing = max(dRing, min(rel - arc, 2.0 * PI - rel) * rl);

    // Arrowhead at the end of the arc, pointing along the direction of motion
    float pe = start + spin * arc;
    vec2 e = c + rl * vec2(cos(pe), sin(pe));
    vec2 T = spin * vec2(-sin(pe), cos(pe));
    vec2 Nrm = vec2(cos(pe), sin(pe));
    float h = min(HEAD_LEN, 0.9 * rl);
    return min(dRing, headDist(dot(p - e, T), dot(p - e, Nrm), h, 0.6 * h));
  }

  void main() {
    float r = length(vLocal);
    float fw = fwidth(r);

    // Which zone are we in (r0 .. r1), and how close to a zone boundary?
    float r0 = 0.0, r1 = 1.0, conv = 0.0, prev = 0.0;
    float line = 0.0;
    bool found = false;
    for (int i = 0; i < MAX_ZONES; i++) {
      if (i >= uZoneCount) break;
      if (!found && r <= uZoneTo[i]) { r0 = prev; r1 = uZoneTo[i]; conv = uZoneConv[i]; found = true; }
      if (i < uZoneCount - 1) {                            // no line at the surface itself
        float dPix = abs(r - uZoneTo[i]) / max(fw, 1e-6);
        line = max(line, clamp(0.5 * uLineWidth + 0.5 - dPix, 0.0, 1.0));
      }
      prev = uZoneTo[i];
    }

    vec3 col = mix(uRadColor, uConvColor, conv);
    col = mix(col, vec3(1.0), uCentreWhite * (1.0 - r) * (1.0 - r));   // hotter towards the centre
    col = mix(col, vec3(0.0), 0.45 * line);                             // thin dark boundary lines

    if (uArrowsOn > 0.5) {
      float px = max(fwidth(vLocal.x), fwidth(vLocal.y));  // one pixel, in stellar radii
      float cell = 0.0;
      float d = conv > 0.5 ? convectiveArrow(vLocal, r0, r1, cell) : radiativeArrow(vLocal, r0, r1);
      col *= 1.0 - 0.08 * cell;                                          // faint convection cell
      col = mix(col, uArrowColor, uArrowOpacity * coverage(d, px));
    }

    gl_FragColor = vec4(col * uShade, 1.0);
  }
`;

const GLOW_VERTEX = `
  varying vec2 vP;            // position in the view plane (same units as the star's radius)
  void main() {
    vP = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// The glow, in two parts (loosely after extreme-UV pictures of the Sun):
//   rim    - a thin, bright ring hugging the limb
//   corona - bright at the limb, then a steep fall-off with a faint tail, broken up into
//            faint streaks that point away from the star and drift very slowly
const GLOW_FRAGMENT = `
  uniform vec3  uColor;
  uniform float uR;           // radius of the star
  uniform float uGlowSize;    // how far the corona reaches, in stellar radii (roughly)
  uniform float uGlow;        // overall brightness
  uniform float uRim;         // brightness of the thin rim
  uniform float uRays;        // strength of the streaks, 0 = smooth
  uniform float uTime;        // seconds, for the slow drift of the streaks
  uniform float uHalf;        // half the size of the smaller canvas side
  varying vec2 vP;

  #define RIM_WIDTH 0.035     // rim thickness, in stellar radii

  float hash1(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
  }
  float vnoise(vec3 p) {      // smooth value noise
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = mix(mix(hash1(i),                    hash1(i + vec3(1,0,0)), f.x),
                  mix(hash1(i + vec3(0,1,0)),      hash1(i + vec3(1,1,0)), f.x), f.y);
    float b = mix(mix(hash1(i + vec3(0,0,1)),      hash1(i + vec3(1,0,1)), f.x),
                  mix(hash1(i + vec3(0,1,1)),      hash1(i + vec3(1,1,1)), f.x), f.y);
    return mix(a, b, f.z);
  }

  void main() {
    float d = length(vP);
    float x = max(d - uR, 0.0) / uR;                         // distance above the limb, in stellar radii

    // Streaks: noise that depends mostly on the direction around the star, and only slowly
    // on the height, so it is stretched into rays
    vec2 dir = vP / max(d, 1e-6);
    float n = 0.65 * vnoise(vec3(dir * 6.0, 1.5 * x - 0.03 * uTime))
            + 0.35 * vnoise(vec3(dir * 15.0, 3.0 * x + 0.05 * uTime + 7.0));
    float streak = 1.0 + uRays * 2.0 * (n - 0.5) * smoothstep(0.0, 0.06, x);

    float rim = uRim * exp(-x / RIM_WIDTH);
    float corona = pow(1.0 + x / (0.12 * uGlowSize), -2.2) * max(streak, 0.0);

    float fade = 1.0 - smoothstep(0.7 * uHalf, uHalf, d);   // nothing left at the canvas edge
    rim    *= uGlow * fade;
    corona *= uGlow * fade * 0.6;

    vec3 rimColor = mix(uColor, vec3(1.0), 0.5);             // the rim is whiter than the surface
    vec3 col = rimColor * rim + uColor * corona;
    float a = clamp(rim + corona, 0.0, 1.0);
    gl_FragColor = vec4(min(col, vec3(1.0)), a);             // premultiplied alpha
  }
`;

// ---------- The star ----------

export function createStellar(container, options = {}) {
  const opts = {
    width: 500, height: 500,       // layout size in CSS pixels (the canvas is transparent)
    renderScale: 1,                // render-resolution multiplier (the plugin sets it to reveal's slide scale)
    color: '#ffb347',              // any CSS color
    temperature: null,             // kelvin; if set, it replaces "color" (e.g. 3500 red dwarf, 10000 blue-white)
    radius: 0.45,                  // star radius as a fraction of half the canvas height (1 = touches the edge)
    rotationPeriod: 20,            // seconds per revolution; 0 = no rotation; negative = the other way
    tilt: 20,                      // degrees the rotation axis is tilted towards the viewer
    limbDarkening: 0.6,            // 0 = flat disc, 1 = strongly darkened edge
    glow: 0.6,                     // overall glow brightness (0 = none)
    glowSize: 1.0,                 // how far the corona reaches (bigger = slower fall-off)
    glowRim: 1.0,                  // brightness of the thin bright rim at the limb (0 = none)
    glowRays: 0.5,                 // faint streaks in the corona (0 = smooth, 1 = strong)
    grid: false,                   // latitude/longitude lines, to see the rotation
    gridSpacing: 30,               // degrees; pick a divisor of 360 (10, 15, 20, 30, 45, ...)

    texture: 'none',               // 'none' | 'granulation' | 'spots' | 'both'
    granulation: null,             // strength 0..1; null = take it from the texture preset
    granulationScale: 10,          // cells across the radius: smaller = bigger, more cartoonish cells
    granulationSpeed: 1,           // how fast the cells boil (0 = frozen)
    spots: null,                   // number of spots (max 24); null = take it from the texture preset
    spotSize: 7,                   // typical angular radius of a spot, in degrees
    spotLatitude: 30,              // spots appear between -spotLatitude and +spotLatitude degrees
    spotSeed: 1,                   // different seed = different spot pattern

    cut: false,                    // remove a wedge to show the interior
    cutOpen: false,                // false = starts closed and opens on request (click / slide trigger)
    cutAnimate: true,              // true = the wedge opens smoothly; false = it snaps open
    cutDuration: 2,                // seconds the opening (or closing) takes
    cutAngle: 90,                  // opening of the wedge in degrees (up to 180)
    cutDirection: 0,               // degrees around the axis; 0 = the wedge faces the viewer
    structure: 'sun',              // 'sun' | 'red-giant' | 'massive' | 'dwarf'
    zones: null,                   // your own zones, e.g. "radiative:0.71, convective:1"; null = from structure
    radiativeColor: null,          // CSS color of radiative zones; null = the star color, lightened
    convectiveColor: null,         // CSS color of convective zones; null = the star color, darkened
    centreWhite: 0.45,             // how much whiter the cut gets towards the centre (0 = flat colors)

    arrows: true,                  // arrows in the interior: wiggly (radiative) and loops (convective)
    arrowColor: '#000000',         // any CSS color
    arrowOpacity: 0.55,            // 0 = invisible, 1 = solid
    arrowSpeed: 1,                 // animation speed (0 = frozen)
    radiativeArrows: 5,            // wiggly arrows per cut face
    ...options
  };

  // Warn about misspelled option names
  const known = new Set(Object.keys(opts));
  for (const key of Object.keys(options)) {
    if (!known.has(key)) console.warn(`createStellar: unknown option "${key}"`);
  }

  // Reserve the layout space
  container.style.width = opts.width + 'px';
  container.style.height = opts.height + 'px';

  // Orthographic camera: the canvas spans y = -1..1 and x = -aspect..aspect
  const aspect = opts.width / opts.height;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-aspect, aspect, 1, -1, 0.1, 10);
  camera.position.z = 5;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);                     // transparent background
  renderer.setSize(opts.width, opts.height);               // also pins the canvas' CSS size
  container.appendChild(renderer.domElement);

  // The surface: a unit sphere scaled to the star's radius. "pivot" holds the tilt; "star" spins inside it.
  const surfaceUniforms = {
    uColor:       { value: new THREE.Color() },
    uLimb:        { value: 0.6 },
    uTime:        { value: 0.0 },
    uGran:        { value: 0.0 },
    uGranScale:   { value: 10.0 },
    uSpotCount:   { value: 0 },
    uSpots:       { value: Array.from({ length: MAX_SPOTS }, () => new THREE.Vector4()) },
    uGridOn:      { value: 0.0 },
    uGridSpacing: { value: 0.5 },
    uGridWidth:   { value: 1.0 },
    uSpin:        { value: 0.0 },
    uCutOn:       { value: 0.0 },
    uCutN1:       { value: new THREE.Vector3() },
    uCutN2:       { value: new THREE.Vector3() },
  };
  const geometry = new THREE.SphereGeometry(1, 128, 64);
  const surfaceMaterial = new THREE.ShaderMaterial({
    uniforms: surfaceUniforms,
    vertexShader: SURFACE_VERTEX,
    fragmentShader: SURFACE_FRAGMENT,
  });
  const star = new THREE.Mesh(geometry, surfaceMaterial);
  const pivot = new THREE.Group();
  pivot.add(star);
  scene.add(pivot);

  // The cut: two half-disc faces in the tilted frame. They do not spin, so the opening keeps
  // facing the same way while the surface turns past it.
  const faceUniforms = {
    uRadColor:     { value: new THREE.Color() },
    uConvColor:    { value: new THREE.Color() },
    uZoneCount:    { value: 1 },
    uZoneTo:       { value: new Array(MAX_ZONES).fill(1) },
    uZoneConv:     { value: new Array(MAX_ZONES).fill(0) },
    uCentreWhite:  { value: 0.45 },
    uLineWidth:    { value: 1.5 },
    uArrowsOn:     { value: 1.0 },
    uArrowTime:    { value: 0.0 },
    uArrowColor:   { value: new THREE.Color() },
    uArrowOpacity: { value: 0.55 },
    uRays:         { value: 5 },
  };
  const faceGeometry = new THREE.CircleGeometry(1, 128, -Math.PI / 2, Math.PI);   // the x >= 0 half
  const makeFace = shade => new THREE.Mesh(faceGeometry, new THREE.ShaderMaterial({
    uniforms: { ...faceUniforms, uShade: { value: shade } },   // shares every uniform except uShade
    vertexShader: FACE_VERTEX,
    fragmentShader: FACE_FRAGMENT,
    side: THREE.DoubleSide,
  }));
  const face1 = makeFace(1.0);
  const face2 = makeFace(0.82);
  const cutGroup = new THREE.Group();
  cutGroup.add(face1, face2);
  pivot.add(cutGroup);

  // The glow: a plane behind the star that fills the whole view
  const glowUniforms = {
    uColor:    { value: new THREE.Color() },
    uR:        { value: 0.45 },
    uGlowSize: { value: 1.0 },
    uGlow:     { value: 1.0 },
    uRim:      { value: 1.0 },
    uRays:     { value: 0.5 },
    uTime:     { value: 0.0 },
    uHalf:     { value: Math.min(aspect, 1) },
  };
  const glowGeometry = new THREE.PlaneGeometry(2 * aspect, 2);
  const glowMaterial = new THREE.ShaderMaterial({
    uniforms: glowUniforms,
    vertexShader: GLOW_VERTEX,
    fragmentShader: GLOW_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,                        // "over", with premultiplied alpha
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const glow = new THREE.Mesh(glowGeometry, glowMaterial);
  glow.position.z = -2;                                    // behind the star, which spans z = -radius..radius
  scene.add(glow);

  // ---- cut opening state ----
  // cutProgress runs from 0 (closed) to 1 (open); each frame it moves towards cutTarget.
  let cutProgress = 0;
  let cutTarget = 0;

  // Jump straight to open or closed, without animating
  function snapCut(open) {
    cutProgress = cutTarget = open ? 1 : 0;
    applyCut();
    if (frameId === null) renderer.render(scene, camera);
  }

  // Back to the starting state (closed, unless cutOpen)
  function resetCut() {
    snapCut(opts.cutOpen);
  }

  // Place the wedge for the current opening
  function applyCut() {
    const open = cutProgress * cutProgress * (3 - 2 * cutProgress);                          // eased 0..1
    const span = open * Math.min(180, Math.max(0, opts.cutAngle)) * Math.PI / 180;
    const on = opts.cut && span > 0.01;

    // Azimuth phi is measured around the axis from the viewer (+z) towards +x. The wedge spans
    // phi1 .. phi2; each face is the half plane at one of those angles.
    const centre = opts.cutDirection * Math.PI / 180;
    const phi1 = centre - span / 2;
    const phi2 = centre + span / 2;
    face1.rotation.y = phi1 - Math.PI / 2;                 // turns the half disc's +x onto direction phi
    face2.rotation.y = phi2 - Math.PI / 2;
    // Plane normals pointing into the wedge: "inside" = positive side of both
    surfaceUniforms.uCutN1.value.set(Math.cos(phi1), 0, -Math.sin(phi1));
    surfaceUniforms.uCutN2.value.set(-Math.cos(phi2), 0, Math.sin(phi2));
    surfaceUniforms.uCutOn.value = on ? 1.0 : 0.0;
    cutGroup.visible = on;
  }

  // Push the current options into the scene
  function applyOptions() {
    // Render resolution: display pixel ratio x slide scale, capped at a 4096-pixel buffer
    const ratio = Math.min(window.devicePixelRatio * opts.renderScale,
                           4096 / Math.max(opts.width, opts.height));
    if (renderer.getPixelRatio() !== ratio) renderer.setPixelRatio(ratio);

    const css = opts.temperature ? temperatureToColor(opts.temperature) : opts.color;
    const base = toUniformColor(css);
    surfaceUniforms.uColor.value.copy(base);
    glowUniforms.uColor.value.copy(base);

    surfaceUniforms.uLimb.value = opts.limbDarkening;
    surfaceUniforms.uGridOn.value = opts.grid ? 1.0 : 0.0;
    surfaceUniforms.uGridSpacing.value = opts.gridSpacing * Math.PI / 180;
    surfaceUniforms.uGridWidth.value = 1.2 * renderer.getPixelRatio();   // device pixels

    // Surface texture: the preset gives the defaults, explicit numbers override them
    if (!(opts.texture in PRESETS)) {
      console.warn(`createStellar: unknown texture "${opts.texture}" (use ${Object.keys(PRESETS).join(', ')})`);
    }
    const preset = PRESETS[opts.texture] ?? PRESETS.none;
    surfaceUniforms.uGran.value = opts.granulation ?? preset.granulation;
    surfaceUniforms.uGranScale.value = Math.max(1, opts.granulationScale);

    const nSpots = Math.min(MAX_SPOTS, Math.max(0, Math.round(opts.spots ?? preset.spots)));
    const spots = makeSpots(nSpots, opts.spotSize, opts.spotLatitude, opts.spotSeed);
    for (let i = 0; i < MAX_SPOTS; i++) {
      const s = spots[i] ?? [0, 0, 0, 0];
      surfaceUniforms.uSpots.value[i].set(s[0], s[1], s[2], s[3]);
    }
    surfaceUniforms.uSpotCount.value = nSpots;

    star.scale.setScalar(opts.radius);
    glowUniforms.uR.value = opts.radius;
    glowUniforms.uGlowSize.value = Math.max(0.05, opts.glowSize);
    glowUniforms.uGlow.value = opts.glow;
    glowUniforms.uRim.value = opts.glowRim;
    glowUniforms.uRays.value = opts.glowRays;

    pivot.rotation.x = opts.tilt * Math.PI / 180;          // north pole towards the viewer

    // ---- the interior ----
    cutGroup.scale.setScalar(opts.radius);
    applyCut();

    // Zones: your own list wins over the named structure
    if (opts.zones == null && !(opts.structure in STRUCTURES)) {
      console.warn(`createStellar: unknown structure "${opts.structure}" (use ${Object.keys(STRUCTURES).join(', ')})`);
    }
    const zones = parseZones(opts.zones ?? STRUCTURES[opts.structure] ?? STRUCTURES.sun);
    faceUniforms.uZoneCount.value = zones.length;
    for (let i = 0; i < MAX_ZONES; i++) {
      faceUniforms.uZoneTo.value[i] = zones[i]?.to ?? 1;
      faceUniforms.uZoneConv.value[i] = zones[i]?.convective ? 1 : 0;
    }
    faceUniforms.uRadColor.value.copy(opts.radiativeColor
      ? toUniformColor(opts.radiativeColor) : base.clone().lerp(new THREE.Color(1, 1, 1), 0.35));
    faceUniforms.uConvColor.value.copy(opts.convectiveColor
      ? toUniformColor(opts.convectiveColor) : base.clone().multiplyScalar(0.75));
    faceUniforms.uCentreWhite.value = opts.centreWhite;
    faceUniforms.uLineWidth.value = 1.5 * renderer.getPixelRatio();      // device pixels

    faceUniforms.uArrowsOn.value = opts.arrows ? 1.0 : 0.0;
    faceUniforms.uArrowColor.value.copy(toUniformColor(opts.arrowColor));
    faceUniforms.uArrowOpacity.value = opts.arrowOpacity;
    faceUniforms.uRays.value = Math.max(1, Math.round(opts.radiativeArrows));
  }
  // Animation loop, with start/stop so the reveal plugin can pause hidden slides
  let frameId = null;
  applyOptions();
  resetCut();

  let angle = 0;
  let boil = 0;
  let arrowTime = 0;
  let last = performance.now();

  function animate() {
    frameId = requestAnimationFrame(animate);
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;

    if (opts.rotationPeriod) angle += 2 * Math.PI * dt / opts.rotationPeriod;
    star.rotation.y = angle;
    surfaceUniforms.uSpin.value = angle;                   // so the shader knows where the fixed cut is

    boil += dt * opts.granulationSpeed;
    surfaceUniforms.uTime.value = boil;
    glowUniforms.uTime.value += dt;                        // slow drift of the corona streaks

    arrowTime += dt * opts.arrowSpeed;
    faceUniforms.uArrowTime.value = arrowTime;

    // Opening / closing the wedge
    if (opts.cut && cutProgress !== cutTarget) {
      const step = opts.cutAnimate ? dt / Math.max(0.01, opts.cutDuration) : 1;
      cutProgress = cutTarget > cutProgress ? Math.min(cutTarget, cutProgress + step)
                                            : Math.max(cutTarget, cutProgress - step);
      applyCut();
    }

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

  // Open or close the wedge on request; the animation loop does the moving
  function setCutTarget(t) {
    cutTarget = t;
    if (frameId === null) snapCut(t === 1);                // paused: nothing would animate it
  }

  return {
    start,
    stop,
    resetCut,                                              // back to the starting state, instantly
    snapCut,                                               // snapCut(true / false): open / closed, instantly
    openCut:   () => setCutTarget(1),
    closeCut:  () => setCutTarget(0),
    toggleCut: () => setCutTarget(cutTarget > 0.5 ? 0 : 1),
    // change any option except width and height while it runs
    set(newOpts) {
      Object.assign(opts, newOpts);
      applyOptions();
      if ('cut' in newOpts || 'cutOpen' in newOpts) resetCut();   // back to the starting state
      if (frameId === null) renderer.render(scene, camera);   // paused: redraw once
    },
    dispose() {
      stop();
      renderer.dispose();
      geometry.dispose();
      surfaceMaterial.dispose();
      faceGeometry.dispose();
      face1.material.dispose();
      face2.material.dispose();
      glowGeometry.dispose();
      glowMaterial.dispose();
      renderer.domElement.remove();
    }
  };
}
