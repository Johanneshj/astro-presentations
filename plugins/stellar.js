// js_routines/stellar.js
// A rotating, glowing star with optional surface textures and an optional cutaway that shows the
// interior zones with animated arrows, cut as a wedge from pole to pole.
// The two flat faces of the cut, seen together, look like a disc in four quarters; each quarter can
// show one "ingredient" of a star (option regions):
//   zones       - radiative and convective zones with their arrows
//   burning     - the glowing burning core with rotating radiation trefoils
//   photons     - photons random-walking from the core out to the surface (opacity)
//   hydrostatic - shells; at each boundary gravity presses down and pressure pushes up, more so deeper in
// Quarters, clockwise: 1 = upper left, 2 = upper right, 3 = lower right, 4 = lower left (left = face 1).
// Orthographic view: the canvas spans y = -1 .. +1 and x = -aspect .. +aspect; the star's radius is
// given in those units.
import * as THREE from 'three';
import { createRayPainter, DISC as RAY_DISC } from './lib/rays.js';

const MAX_SPOTS = 24;   // must match MAX_SPOTS in the surface shader
const MAX_ZONES = 6;    // must match MAX_ZONES in the cut-face shader
const MAX_TREFOILS = 8; // burning symbols per region
// Names for what a quarter shows; several names mean the same thing
const EFFECTS = {
  plain: 0, none: 0,
  zones: 1, transport: 1, 'energy transport': 1,
  photons: 2, opacity: 2,
  burning: 3, 'nuclear burning': 3,
  hydrostatic: 4, 'hydrostatic equilibrium': 4,
  question: 5, unknown: 5, '?': 5,
  rays: 6, 'p modes': 6, 'acoustic rays': 6,
};
const FACE_R = 1.45;    // the face meshes reach beyond the surface, for the gravity arrow (the rest is cut away)

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

// Shapes of the "ingredients" (see regions). Lengths in stellar radii.
const INGREDIENT_STYLE = {
  // Hydrostatic quarter: shells, and at each shell boundary gravity (pressing down from above) meets
  // pressure (pushing up from below). The deepest pair is the biggest.
  hydroLength:   0.11,  // arrow length of the deepest pair (at most 0.45 / layers)
  hydroWidth:    0.036, // half width of the deepest arrows' shafts
  hydroHead:     0.045, // head length of the deepest arrows (the head is 1.7 x as wide as the shaft)
  hydroOuter:    0.5,   // size of the outermost pair relative to the deepest (1 = all the same)
  hydroGap:      0.008, // space between the two tips at a boundary
  hydroShade:    0.1,   // how much darker every other shell is
  walkStep:      0.035, // length of one photon step
  walkBias:      0.85,  // outward push per step (0 = a pure random walk that rarely gets out)
  walkSteps:     100,   // a photon's path is cut off after this many steps (must be <= 160)
  walkWidth:     0.008, // half width of the photon trail
  photonSize:    0.018, // radius of the photon dot
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

// What each texture preset means: granulation strength (0..1), number of spots, and a pattern:
//   mottled  soft cloudy patches, slowly drifting
//   bands    wavy stripes along the latitudes, slowly shearing (a hint of differential rotation)
//   network  a fine web of thin bright filaments (like the Sun's magnetic network)
const PRESETS = {
  none:        { granulation: 0, spots: 0 },
  granulation: { granulation: 1, spots: 0 },
  spots:       { granulation: 0, spots: 6 },
  both:        { granulation: 0.8, spots: 6 },
  mottled:     { granulation: 0, spots: 0, pattern: 1, scale: 2.5 },
  bands:       { granulation: 0, spots: 0, pattern: 2, scale: 7 },
  network:     { granulation: 0, spots: 0, pattern: 3, scale: 3 },
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
  uniform int   uPattern;              // 0 none, 1 mottled, 2 bands, 3 network (see PRESETS)
  uniform float uPatStrength;          // how strong the pattern is (1 = default)
  uniform float uPatScale;             // its size: patches / bands / meshes across the star
  uniform float uFlow;                 // seconds of drifting for the pattern
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

  // Fractal noise: a few octaves of value noise, 0..1
  float fbm(vec3 p) {
    float sum = 0.0, amp = 0.5;
    for (int i = 0; i < 4; i++) { sum += amp * vnoise(p); p = p * 2.03 + 17.1; amp *= 0.5; }
    return sum / 0.9375;
  }

  // Thin ridges (1 on a ridge, 0 away from it): where the noise crosses its middle value
  float ridges(vec3 p, float sharp) {
    return pow(1.0 - abs(2.0 * vnoise(p) - 1.0), sharp);
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

    if (uPattern == 1) {                                   // mottled: soft cloudy patches
      vec3 q = p * uPatScale + vec3(0.0, 0.0, 0.04 * uFlow);
      vec3 w = vec3(fbm(q), fbm(q + 5.2), fbm(q + 9.7));   // warp the noise by noise: swirly, gassy
      float n = fbm(q + 1.6 * w + vec3(0.03 * uFlow));
      tex *= 1.0 + uPatStrength * 0.55 * (n - 0.5);
    } else if (uPattern == 2) {                            // bands along the latitudes
      float lat = asin(clamp(p.y, -1.0, 1.0));
      float shear = 0.06 * uFlow * (1.0 - p.y * p.y);      // faster at the equator: the bands slide past each other
      vec3 q = vec3(cos(shear) * p.x - sin(shear) * p.z, p.y, sin(shear) * p.x + cos(shear) * p.z);
      float wave = fbm(q * 2.5) - 0.5;
      float b = sin((lat + 0.22 * wave) * uPatScale) + 0.5 * sin((lat - 0.15 * wave) * uPatScale * 2.3 + 1.3);
      tex *= 1.0 + uPatStrength * 0.1 * b + uPatStrength * 0.12 * (fbm(q * 6.0) - 0.5);
    } else if (uPattern == 3) {                            // network of thin bright filaments
      vec3 q = p * uPatScale + vec3(0.02 * uFlow, 0.0, 0.0);
      float web = max(ridges(q, 10.0), 0.7 * ridges(q * 2.1 + 3.3, 12.0));
      float soft = fbm(q * 0.7) - 0.5;
      tex *= 0.96 + uPatStrength * (0.45 * web + 0.12 * soft);
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

// The two flat faces of the cut. Each is a half disc in its own xy plane (x >= 0, y up), so the
// distance from the star's centre in stellar radii is simply length(position.xy). The meshes reach to
// FACE_R; everything beyond r = 1 is cut away except the gravity arrow.
const FACE_VERTEX = `
  uniform float uStarR;                // the star's radius in world units
  varying vec2 vLocal;
  varying vec2 vScreen;                // where the point is seen, from the star's centre, in stellar radii
  void main() {
    vLocal = position.xy;
    vScreen = (modelMatrix * vec4(position, 1.0)).xy / uStarR;   // (the camera looks straight down z)
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FACE_FRAGMENT = `
  #define MAX_ZONES ${MAX_ZONES}
  #define MAX_TREFOILS ${MAX_TREFOILS}
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
  // Ingredient shapes (from INGREDIENT_STYLE)
  #define HYDRO_LEN     ${glslFloat(INGREDIENT_STYLE.hydroLength)}
  #define HYDRO_W       ${glslFloat(INGREDIENT_STYLE.hydroWidth)}
  #define HYDRO_HEAD    ${glslFloat(INGREDIENT_STYLE.hydroHead)}
  #define HYDRO_OUTER   ${glslFloat(INGREDIENT_STYLE.hydroOuter)}
  #define HYDRO_GAP     ${glslFloat(INGREDIENT_STYLE.hydroGap)}
  #define HYDRO_SHADE   ${glslFloat(INGREDIENT_STYLE.hydroShade)}
  #define WALK_STEP     ${glslFloat(INGREDIENT_STYLE.walkStep)}
  #define WALK_BIAS     ${glslFloat(INGREDIENT_STYLE.walkBias)}
  #define WALK_STEPS    ${Math.min(160, INGREDIENT_STYLE.walkSteps)}
  #define WALK_W        ${glslFloat(INGREDIENT_STYLE.walkWidth)}
  #define PHOTON_R      ${glslFloat(INGREDIENT_STYLE.photonSize)}

  uniform vec3  uRadColor;             // color of radiative zones
  uniform vec3  uConvColor;            // color of convective zones
  uniform int   uZoneCount;
  uniform float uZoneTo[MAX_ZONES];    // outer edge of each zone, r/R
  uniform float uZoneConv[MAX_ZONES];  // 1 = convective, 0 = radiative
  uniform float uCentreWhite;          // how much whiter (hotter-looking) the centre is
  uniform float uLineWidth;            // boundary line width in device pixels
  uniform float uShade;                // the faces get slightly different brightness, so they read as 3D
  uniform float uArrowsOn;
  uniform float uArrowTime;            // seconds of arrow animation
  uniform float uTime;                 // seconds, unscaled
  uniform vec3  uArrowColor;
  uniform float uArrowOpacity;
  uniform int   uRays;                 // radiative arrows per face

  // The face's angular layout (local polar angle): centre and span. For a half disc: 0 and pi.
  uniform float uThC;
  uniform float uThS;

  // What this face shows (EFFECTS codes: 0 plain, 1 zones, 2 photons, 3 burning, 4 hydrostatic):
  // with uSplit = 1, uEffA in the lower quarter and uEffB in the upper one; else uEffA everywhere
  uniform float uSplit;
  uniform float uEffA;
  uniform float uEffB;
  // How far each quarter's ingredient is shown (0 = plain interior, 1 = fully): lower / upper quarter
  uniform float uShowA;
  uniform float uShowB;

  // Burning core
  uniform float uCoreR;
  uniform float uCoreShown;            // 1 = one of the quarters burns: the core radius is marked in the others too
  uniform float uCoreFade;             // ... as far as that quarter is shown
  uniform float uCoreGlow;             // brightness of the core's glow
  uniform vec3  uGlowColor;
  uniform vec3  uBurnColor;            // the trefoils' disc
  uniform vec3  uBurnInk;              // the trefoil itself
  uniform float uBurnSpeed;
  uniform int   uTrefN;
  uniform float uTrefSize;

  // Hydrostatic equilibrium
  uniform int   uHydroLayers;          // number of shells
  uniform vec3  uPressColor;
  uniform vec3  uGravColor;

  // Photon random walks
  uniform int   uWalkN;
  uniform float uWalkFrom;
  uniform float uWalkSpeed;            // steps per second
  uniform vec3  uWalkColor;

  // Acoustic rays (drawn by lib/rays.js into a texture of the whole disc)
  uniform sampler2D uRayTex;
  uniform float uSide;                 // -1 = the left face, 1 = the right one: together they make one disc

  // The question mark
  uniform vec3  uQColor;
  uniform float uQSize;
  varying vec2 vLocal;
  varying vec2 vScreen;

  // The region being drawn: its centre angle and span (set in main, used by the drawing functions)
  float gC, gS;

  // Angle a - b, wrapped into -pi .. pi
  float wrapPi(float a) { return mod(a + PI, 2.0 * PI) - PI; }

  // The arrows are drawn as "signed distances": d < 0 inside the shape, d > 0 outside,
  // in stellar radii. coverage() turns that into a smooth (anti-aliased) 0..1 edge.
  float coverage(float d, float px) { return clamp(0.5 - d / px, 0.0, 1.0); }

  // Arrowhead: a triangle with its base at along = 0 and its tip at along = h, half width hw at the base
  float headDist(float along, float side, float h, float hw) {
    float edge = (abs(side) - hw * (1.0 - along / h)) / sqrt(1.0 + (hw / h) * (hw / h));
    return max(max(-along, along - h), edge);
  }

  // A straight arrow from a to b (tip at b): shaft half width w, head length hl
  float straightArrow(vec2 p, vec2 a, vec2 b, float w, float hl) {
    vec2 dir = normalize(b - a);
    float L = length(b - a);
    float along = dot(p - a, dir);
    float side = dot(p - a, vec2(-dir.y, dir.x));
    // the shaft runs a little way into the head, so the two overlap and there is no seam (and no
    // outline) where they meet. Only a little: the head is wider than the shaft only in its first
    // 1 - 1/1.7 = 41 % (see the 1.7 below), beyond that the shaft's corners would stick out.
    float shaft = max(abs(side) - w, max(-along, along - (L - 0.8 * hl)));
    return min(shaft, headDist(along - (L - hl), side, hl, 1.7 * w));
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
    float rel = wrapPi(atan(p.y, p.x) - gC) + 0.5 * gS;       // 0 .. span across the region
    float k = clamp(floor(rel / (gS / N)), 0.0, N - 1.0);
    float thk = gC - 0.5 * gS + (k + 0.5) * gS / N;
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
    float n = max(1.0, floor(gS * rm / (CELL_GAP * rc)));     // how many cells fit along the arc

    float rel = wrapPi(atan(p.y, p.x) - gC) + 0.5 * gS;
    float j = clamp(floor(rel / (gS / n)), 0.0, n - 1.0);
    float thj = gC - 0.5 * gS + (j + 0.5) * gS / n;
    vec2 c = rm * vec2(cos(thj), sin(thj));                // centre of the nearest cell
    float spin = mod(j, 2.0) < 0.5 ? 1.0 : -1.0;

    vec2 q = p - c;
    float rho = length(q);
    cell = 1.0 - smoothstep(0.85 * rc, rc, rho);

    // The loop: a ring of radius rl, kept only over an arc of LOOP_ARC * pi that turns with time
    float rl = LOOP_FRAC * rc;
    float arc = LOOP_ARC * PI;
    float start = spin * LOOP_SPEED * uArrowTime;
    float relA = mod(spin * (atan(q.y, q.x) - start), 2.0 * PI);   // angle from the arc's start, along the spin
    float dRing = abs(rho - rl) - 0.5 * LINE_W;
    if (relA > arc) dRing = max(dRing, min(relA - arc, 2.0 * PI - relA) * rl);

    // Arrowhead at the end of the arc, pointing along the direction of motion
    float pe = start + spin * arc;
    vec2 e = c + rl * vec2(cos(pe), sin(pe));
    vec2 T = spin * vec2(-sin(pe), cos(pe));
    vec2 Nrm = vec2(cos(pe), sin(pe));
    float h = min(HEAD_LEN, 0.9 * rl);
    return min(dRing, headDist(dot(p - e, T), dot(p - e, Nrm), h, 0.6 * h));
  }

  // ---- hydrostatic equilibrium: shells and paired arrows ----
  // At the boundary of shell k (radius k / n) a gravity arrow points down onto it from above and a
  // pressure arrow pushes up against it from below; deeper pairs are bigger. Returns the distances
  // to the nearest gravity (x) and pressure (y) arrow.
  vec2 hydroArrows(vec2 p, vec2 dir) {
    float n = float(uHydroLayers);
    float dG = 10.0, dP = 10.0;
    for (int k = 1; k <= 8; k++) {
      if (k > uHydroLayers) break;
      float b = float(k) / n;
      float depth = n > 1.0 ? (float(k) - 1.0) / (n - 1.0) : 0.0;   // 0 = deepest, 1 = surface
      float sz = mix(1.0, HYDRO_OUTER, depth);
      float len = min(HYDRO_LEN * sz, 0.45 / n);
      float w = HYDRO_W * sz, hl = min(HYDRO_HEAD * sz, 0.5 * len);
      dG = min(dG, straightArrow(p, (b + HYDRO_GAP + len) * dir, (b + HYDRO_GAP) * dir, w, hl));
      dP = min(dP, straightArrow(p, (b - HYDRO_GAP - len) * dir, (b - HYDRO_GAP) * dir, w, hl));
    }
    return vec2(dG, dP);
  }

  // ---- burning core: the radiation trefoil ----
  // Returns (disc coverage, ink coverage) for a trefoil of the given size, turned by angle rot
  vec2 trefoil(vec2 q, float size, float rot, float px) {
    float rr = length(q) / size;
    float pr = px / size;
    float disc = clamp(0.5 - (rr - 1.0) / pr, 0.0, 1.0);
    float th = atan(q.y, q.x) - rot;
    float sector = mod(th + PI / 6.0, 2.0 * PI / 3.0) - PI / 3.0;   // 0 at a blade's centre line
    float bladeSide = abs(sector) - PI / 6.0;                      // < 0 inside a 60 degree blade
    float blade = min(clamp(0.5 - bladeSide * rr / pr, 0.0, 1.0),
                      clamp(0.5 - max(0.30 - rr, rr - 0.86) / pr, 0.0, 1.0));
    float hub = clamp(0.5 - (rr - 0.18) / pr, 0.0, 1.0);
    return vec2(disc, max(blade, hub) * disc);
  }

  // ---- photon random walks ----
  vec2 hash2(vec2 p) {
    vec2 q = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(q) * 43758.5453);
  }

  float segDist(vec2 p, vec2 a, vec2 b) {
    vec2 ab = b - a;
    float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-9), 0.0, 1.0);
    return length(p - a - t * ab);
  }

  // Distance to photon trail w (x) and to the photon itself (y); z = trail brightness (fades out)
  vec3 walk(vec2 p, float w) {
    float cycleLen = float(WALK_STEPS) + 12.0;             // steps per path, plus a short pause
    float hs = uTime * uWalkSpeed + w * 37.3;             // the photons start at different times
    float cycle = floor(hs / cycleLen);
    float local = mod(hs, cycleLen);                       // how far along this path the photon is
    vec2 seed = vec2(w * 17.0 + 3.0, cycle * 31.0 + 5.0);

    float th0 = gC + (hash2(seed).x - 0.5) * 0.8 * gS;
    vec2 pos = uWalkFrom * vec2(cos(th0), sin(th0));
    float dTrail = 10.0, dPhoton = 10.0;
    float endStep = float(WALK_STEPS);
    for (int k = 0; k < WALK_STEPS; k++) {
      float fk = float(k);
      if (fk >= local) break;
      vec2 h = hash2(seed + vec2(fk * 1.37, fk * 0.71));
      float a = 2.0 * PI * h.x;
      vec2 d = normalize(vec2(cos(a), sin(a)) + WALK_BIAS * normalize(pos));
      vec2 nxt = pos + WALK_STEP * (0.6 + 0.8 * h.y) * d;
      // stay inside the region: mirror at its edges
      float rel = wrapPi(atan(nxt.y, nxt.x) - gC);
      if (abs(rel) > 0.45 * gS) {
        rel = sign(rel) * 0.9 * gS - rel;
        nxt = length(nxt) * vec2(cos(gC + rel), sin(gC + rel));
      }
      bool done = length(nxt) >= 0.995;                     // out at the surface
      if (done) nxt = normalize(nxt) * 0.995;
      vec2 seg = nxt;
      if (fk + 1.0 > local) seg = mix(pos, nxt, fract(local));     // the step in progress
      dTrail = min(dTrail, segDist(p, pos, seg));
      if (fk + 1.0 > local) dPhoton = length(p - seg);
      pos = nxt;
      if (done) { endStep = fk + 1.0; break; }
    }
    float fade = 1.0 - smoothstep(endStep, endStep + 10.0, local);  // the trail fades once the photon is out
    return vec3(dTrail, dPhoton, fade);
  }

  // The trefoil nearest to p: they sit on an arc in the core, spread over the region
  vec3 nearestTrefoil(vec2 p) {                      // x, y = centre, z = index
    float n = float(uTrefN);
    float ring = uTrefN == 1 ? 0.45 * uCoreR : 0.6 * uCoreR;
    float rel = wrapPi(atan(p.y, p.x) - gC) + 0.45 * gS;
    float k = clamp(floor(rel / (0.9 * gS / n)), 0.0, n - 1.0);
    float th = gC - 0.45 * gS + (k + 0.5) * 0.9 * gS / n;
    return vec3(ring * cos(th), ring * sin(th), k);
  }

  // Thin dashed circle of radius rc
  float dashedCircle(float r, float rc, float fw) {
    float dash = step(0.5, fract(atan(vLocal.y, vLocal.x) * rc / 0.03));
    return clamp(1.0 - abs(r - rc) / max(fw, 1e-6), 0.0, 1.0) * dash;
  }

  // Distance to a question mark about 0.8 stellar radii tall, centred on 0
  float questionMark(vec2 p) {
    p.y += 0.015;                                          // a little above the centre (clear of a disk)
    const float W = 0.05;                                  // half the stroke width
    vec2 c = vec2(0.0, 0.24);                              // the hook: an arc round c ...
    const float ra = 0.19;
    vec2 q = p - c;
    float a = atan(q.y, q.x);
    float dArc = a > -0.5 * PI && a < 0.85 * PI            // ... from the left, over the top, down to below c
      ? abs(length(q) - ra)
      : min(length(p - c - ra * vec2(cos(0.85 * PI), sin(0.85 * PI))), length(p - c + vec2(0.0, ra)));
    float dStem = segDist(p, vec2(0.0, c.y - ra), vec2(0.0, -0.1));
    float dDot = length(p - vec2(0.0, -0.27)) - 0.06;
    return min(min(dArc, dStem) - W, dDot);
  }

  void main() {
    float r = length(vLocal);
    float px = max(fwidth(vLocal.x), fwidth(vLocal.y));    // one pixel, in stellar radii
    float fw = fwidth(r);
    float relC = wrapPi(atan(vLocal.y, vLocal.x) - uThC);  // angle from the face's centre line

    // Which region, which effect, and the region's layout
    float eff = uEffA;
    gC = uThC; gS = uThS;
    if (uSplit > 0.5) {
      bool upper = relC >= 0.0;
      eff = upper ? uEffB : uEffA;
      gS = 0.5 * uThS;
      gC = uThC + (upper ? 0.25 : -0.25) * uThS;
    }
    int effect = int(eff + 0.5);
    float show = relC >= 0.0 ? uShowB : uShowA;
    vec2 hydroDir = vec2(cos(gC), sin(gC));

    // Outside the star only the gravity arrow is drawn
    if (r > 1.0) {
      if (effect != 4) discard;
      float dG = hydroArrows(vLocal, hydroDir).x;          // the outermost gravity arrow sticks out
      float a = coverage(dG - 0.008, px) * show;
      if (a <= 0.0) discard;
      vec3 c = mix(vec3(0.0), uGravColor, coverage(dG, px));
      gl_FragColor = vec4(c * a, a);                       // premultiplied: soft edge over the glow
      return;
    }

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

    vec3 emit = vec3(0.0);                                 // light of its own (the core's glow)

    // Background: the zones' colors only in the zones region; elsewhere one plain interior color
    vec3 col = effect == 1 ? mix(uRadColor, uConvColor, conv) : uRadColor;
    col = mix(col, vec3(1.0), uCentreWhite * (1.0 - r) * (1.0 - r));   // hotter towards the centre
    vec3 plain = mix(uRadColor, vec3(1.0), uCentreWhite * (1.0 - r) * (1.0 - r));   // a quarter not shown yet

    // Where a quarter burns, the core radius is marked in the zones and photons quarters too
    float coreEdge = uCoreShown > 0.5 ? uCoreFade * dashedCircle(r, uCoreR, fw) : 0.0;

    if (effect == 1) {                                     // ---- zones ----
      col = mix(col, vec3(0.0), 0.45 * line);                           // thin dark boundary lines
      col = mix(col, uBurnInk, 0.4 * coreEdge);
      if (uArrowsOn > 0.5) {
        float cell = 0.0;
        // the radiative wiggles start at the core's edge when there is a core
        float rStart = uCoreShown > 0.5 && r0 < uCoreR ? uCoreR : r0;
        float d = 1.0;
        if (conv > 0.5) d = convectiveArrow(vLocal, r0, r1, cell);
        else if (r > rStart) d = radiativeArrow(vLocal, rStart, r1);
        col *= 1.0 - 0.08 * cell;                                        // faint convection cell
        col = mix(col, uArrowColor, uArrowOpacity * coverage(d, px));
      }
    } else if (effect == 2) {                              // ---- photons ----
      col = mix(col, uBurnInk, 0.4 * coreEdge);                          // they start at the core
      for (int w = 0; w < 6; w++) {
        if (w >= uWalkN) break;
        vec3 wk = walk(vLocal, float(w));
        col = mix(col, uWalkColor, 0.85 * wk.z * coverage(wk.x - WALK_W, px));
        col = mix(col, vec3(0.05), coverage(wk.y - PHOTON_R - 0.006, px));     // dark ring
        col = mix(col, vec3(1.0, 0.97, 0.6), coverage(wk.y - PHOTON_R, px));  // the photon
      }
    } else if (effect == 3) {                              // ---- burning core ----
      // the glow is light of its own: added after the face's shading (below), reaching past the core
      emit = uCoreGlow * uGlowColor * (0.55 * exp(-pow(r / (1.4 * uCoreR), 2.0))
                                     + 0.45 * exp(-pow(r / (0.5 * uCoreR), 2.0)));   // white-hot centre
      col = mix(col, uBurnInk, 0.5 * dashedCircle(r, uCoreR, fw));
      if (uTrefN > 0) {
        vec3 t = nearestTrefoil(vLocal);
        float rot = (mod(t.z, 2.0) < 0.5 ? 1.0 : -1.0) * uBurnSpeed * uTime + t.z;
        vec2 tf = trefoil(vLocal - t.xy, uTrefSize, rot, px);
        col = mix(col, uBurnColor, tf.x);
        col = mix(col, uBurnInk, tf.y);
      }
    } else if (effect == 4) {                              // ---- hydrostatic equilibrium ----
      float n = float(uHydroLayers);
      col *= 1.0 - HYDRO_SHADE * mod(floor(r * n), 2.0);                   // shells: every other one darker
      float edge = 0.0;
      for (int k = 1; k < 8; k++) {                                        // their boundaries (not the surface)
        if (k >= uHydroLayers) break;
        edge = max(edge, clamp(1.0 - abs(r - float(k) / n) / max(1.5 * fw, 1e-6), 0.0, 1.0));
      }
      col = mix(col, vec3(0.0), 0.5 * edge);
      vec2 d = hydroArrows(vLocal, hydroDir);
      col = mix(col, vec3(0.0), coverage(min(d.x, d.y) - 0.008, px));      // dark outlines
      col = mix(col, uGravColor, coverage(d.x, px));
      col = mix(col, uPressColor, coverage(d.y, px));
    } else if (effect == 5) {                              // ---- we don't know: a question mark ----
      // drawn as the audience sees it (flat on the screen), so it reads across both faces
      float pxS = max(fwidth(vScreen.x), fwidth(vScreen.y));
      float d = uQSize * questionMark(vScreen / uQSize);
      col = mix(col, uQColor, 0.85 * coverage(d, pxS));
    } else if (effect == 6) {                              // ---- acoustic rays ----
      vec2 disc = vec2(uSide * vLocal.x, vLocal.y);        // where we are in the disc the two faces make
      vec4 ray = texture2D(uRayTex, disc * ${glslFloat(0.5 * RAY_DISC)} + 0.5);
      col = mix(col, ray.rgb, ray.a);
    }

    col = mix(plain, col, show);
    emit *= show;

    // A thin line between the two halves of a split face
    if (uSplit > 0.5 && uEffA != uEffB) {
      float dLine = abs(dot(vLocal, vec2(-sin(uThC), cos(uThC)))) / px;
      if (dot(vLocal, vec2(cos(uThC), sin(uThC))) > 0.0) col = mix(col, vec3(0.0), 0.35 * clamp(1.0 - dLine, 0.0, 1.0));
    }

    gl_FragColor = vec4(min(col * uShade + emit, vec3(1.0)), 1.0);
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

    float fade = 1.0 - smoothstep(mix(uR, uHalf, 0.5), uHalf, d);   // nothing left at the canvas edge
    rim    *= uGlow * fade;
    corona *= uGlow * fade * 0.6;

    vec3 rimColor = mix(uColor, vec3(1.0), 0.5);             // the rim is whiter than the surface
    vec3 col = rimColor * rim + uColor * corona;
    float a = clamp(rim + corona, 0.0, 1.0);
    gl_FragColor = vec4(min(col, vec3(1.0)), a);             // premultiplied alpha
  }
`;

// ---------- Accretion disk ----------
// A flat ring in the star's equatorial plane (local xy here; the mesh is turned into the plane).
// Distances in stellar radii. The gas orbits faster close in (Kepler: angular speed ~ r^-1.5), so the
// streaky pattern winds up into arcs. Hot and white-yellow at the inner edge, deep red outside.
const DISK_VERTEX = `
  varying vec2 vLocal;
  void main() {
    vLocal = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const DISK_FRAGMENT = `
  uniform float uTime;
  uniform float uInner;                // inner edge (the gap round the star), stellar radii
  uniform float uOuter;                // outer edge
  uniform float uBright;
  uniform vec3  uHot;                  // colours from the inner edge out
  uniform vec3  uMid;
  uniform vec3  uCool;
  varying vec2 vLocal;

  float hash1(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float vnoise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = mix(mix(hash1(i), hash1(i + vec3(1,0,0)), f.x), mix(hash1(i + vec3(0,1,0)), hash1(i + vec3(1,1,0)), f.x), f.y);
    float b = mix(mix(hash1(i + vec3(0,0,1)), hash1(i + vec3(1,0,1)), f.x), mix(hash1(i + vec3(0,1,1)), hash1(i + vec3(1,1,1)), f.x), f.y);
    return mix(a, b, f.z);
  }
  float fbm(vec3 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.07 + 11.3; a *= 0.5; }
    return s / 0.9375;
  }

  void main() {
    float r = length(vLocal);
    if (r < 0.9 || r > uOuter) discard;               // (inside the star the depth test hides it anyway)
    // orbiting: each radius turns at its own (Kepler) rate, so the pattern shears into arcs
    float phi = atan(vLocal.y, vLocal.x) - uTime * 0.6 * pow(r / uInner, -1.5);
    // swirl: the pattern winds into loose spiral arcs instead of neat rings
    float wind = phi + 1.8 * log(r);
    vec2 ring = vec2(cos(wind), sin(wind));
    float streak = fbm(vec3(ring * 2.6, r * 1.4));
    float clumps = fbm(vec3(ring * 5.0 + r * 0.8, r * 2.5 + 4.0));
    float t = clamp((r - uInner) / (uOuter - uInner), 0.0, 1.0);
    vec3 col = t < 0.35 ? mix(uHot, uMid, smoothstep(0.0, 0.35, t)) : mix(uMid, uCool, smoothstep(0.35, 1.0, t));
    float light = pow(uInner / r, 1.6);                    // lit by the star: brighter close in
    float tex = 0.45 + 1.1 * streak * (0.55 + 0.7 * clumps);
    // soft, slightly ragged edges
    float inner = 0.35 + 0.65 * smoothstep(1.0, uInner * (1.0 + 0.08 * clumps), r);   // a faint glow fills the gap
    float outer = 1.0 - smoothstep(uOuter * 0.55, uOuter, r + 0.3 * (streak - 0.5));
    float a = clamp(inner * outer * (0.35 + 0.75 * tex) * (0.45 + 0.55 * light) * 1.15, 0.0, 1.0);
    vec3 c = col * uBright * (0.5 + 1.1 * light) * tex;
    c = mix(c, vec3(1.0, 0.97, 0.88), 0.55 * smoothstep(0.25, 0.0, t) * light);   // white-hot inner rim
    gl_FragColor = vec4(min(c, vec3(1.6)) * a, a);         // premultiplied alpha
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

    texture: 'none',               // 'none' | 'granulation' | 'spots' | 'both' | 'mottled' | 'bands' | 'network'
    textureStrength: 1,            // mottled / bands / network: how strong (0 = off, 2 = twice as strong)
    textureScale: null,            // ... their size (more = finer); null = the preset's
    textureSpeed: 1,               // ... how fast they drift (0 = frozen)
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

    // What each quarter of the cut shows (see the top of this file): a list such as
    // 'hydrostatic, burning, opacity, transport', clockwise from the upper left.
    // One entry = everywhere; missing entries = plain.
    regions: 'zones',
    coreRadius: 0.2,               // r/R of the burning core
    coreGlow: 0.9,                 // brightness of the core's glow (0 = none)
    coreGlowColor: '#ffd36b',      // added to the face, so it brightens towards white
    burningSymbols: 2,             // trefoils in the burning region (max ${MAX_TREFOILS}; fewer = bigger)
    burningSize: 0.06,             // trefoil radius in stellar radii (made smaller if the core is crowded)
    burningSpeed: 0.6,             // turning speed, radians per second
    burningColor: '#ffd400',       // the trefoil's disc
    burningInk: '#1a1a1a',         // the trefoil itself
    hydrostaticLayers: 4,          // hydrostatic quarter: number of shells (max 8)
    pressureColor: '#ff5a4d',      // hydrostatic quarter: pressure (pushing up from below) ...
    gravityColor: '#4db8ff',       // ... and gravity (pressing down from above)
    photonWalks: 3,                // photons in the photons region (max 6)
    photonSpeed: 12,               // steps per second
    photonColor: '#000000',        // the trail; the photon itself is a bright dot with a dark ring
    questionColor: '#000000',      // the "question" interior: color of the question mark ...
    questionSize: 1,               // ... and its size (1 = about 0.8 stellar radii tall)
    rays: [2, 20],                 // the "rays" interior: the degrees l of the modes whose rays are traced
    rayOmega: 25,                  // the reference angular frequency (core sound speed / radius units)
    rayFrequencies: [1],           // each mode's frequency in units of rayOmega (one value = all)
    rayTrail: 0.8,                 // trail length, as a fraction of a ray's time round the star
    raySpeed: 1,                   // how fast the wave travels along its ray
    rayColors: null,               // one per mode; null = the default palette
    rayWidth: 1,                   // line width (1 = default)
    rayLoop: 0,                    // seconds: the rays repeat exactly after this time (for looping animations; 0 = off)

    disk: false,                   // an accretion disk round the equator (young stars)
    diskInner: 1.25,               // its inner edge, in stellar radii (the gap round the star)
    diskOuter: 4,                  // its outer edge, in stellar radii
    diskSpeed: 1,                  // how fast the gas orbits (0 = frozen)
    diskBrightness: 1,
    diskColors: ['#fff2c4', '#ff9440', '#9c2a1c'],   // inner, middle, outer
    ...options
  };

  // Warn about misspelled option names
  const known = new Set(Object.keys(opts));
  for (const key of Object.keys(options)) {
    if (!known.has(key)) console.warn(`createStellar: unknown option "${key}"`);
  }

  // Reserve the layout space (unless the slide plugin already made it a star-sized box)
  if (!container.classList.contains('star-box')) {
    container.style.width = opts.width + 'px';
    container.style.height = opts.height + 'px';
  }

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
    uPattern:     { value: 0 },
    uPatStrength: { value: 1.0 },
    uPatScale:    { value: 3.0 },
    uFlow:        { value: 0.0 },
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

  // The cut: two half-disc faces in the tilted frame. They do not spin, so the opening keeps facing
  // the same way while the surface turns past it. The geometry reaches to FACE_R for the gravity
  // arrow; the shader cuts the rest away.
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
    uTime:         { value: 0.0 },
    uArrowColor:   { value: new THREE.Color() },
    uArrowOpacity: { value: 0.55 },
    uRays:         { value: 5 },
    uCoreR:        { value: 0.2 },
    uCoreShown:    { value: 0 },
    uCoreFade: { value: 1 },
    uCoreGlow:     { value: 0.9 },
    uGlowColor:    { value: new THREE.Color() },
    uTrefN:        { value: 0 },
    uTrefSize:     { value: 0.05 },
    uBurnColor:    { value: new THREE.Color() },
    uBurnInk:      { value: new THREE.Color() },
    uBurnSpeed:    { value: 0.6 },
    uHydroLayers:  { value: 4 },
    uPressColor:   { value: new THREE.Color() },
    uGravColor:    { value: new THREE.Color() },
    uWalkN:        { value: 0 },
    uWalkFrom:     { value: 0.2 },
    uWalkSpeed:    { value: 8 },
    uWalkColor:    { value: new THREE.Color() },
    uQColor:       { value: new THREE.Color() },
    uRayTex:       { value: null },
    uQSize:        { value: 1 },
    uStarR:        { value: 1 },
  };
  const faceGeometry = new THREE.CircleGeometry(FACE_R, 128, -Math.PI / 2, Math.PI);   // the x >= 0 half
  const makeFace = shade => new THREE.Mesh(faceGeometry, new THREE.ShaderMaterial({
    uniforms: {
      ...faceUniforms,                                     // shared with the other faces
      uShade:   { value: shade },                          // the rest belongs to this face
      uThC:     { value: 0 },
      uThS:     { value: Math.PI },
      uSplit:   { value: 0 },
      uEffA:    { value: 1 },
      uEffB:    { value: 1 },
      uShowA:   { value: 1 },
      uShowB:   { value: 1 },
      uSide:    { value: 1 },
    },
    vertexShader: FACE_VERTEX,
    fragmentShader: FACE_FRAGMENT,
    side: THREE.DoubleSide,
    transparent: true,                                     // soft edges of the gravity arrow
    blending: THREE.CustomBlending,                        // premultiplied alpha, as for the glow
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  }));
  const face1 = makeFace(1.0);
  const face2 = makeFace(0.82);
  const faces = [face1, face2];
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

  // ---- accretion disk: in the tilted frame (pivot), turned into the equatorial plane ----
  const diskUniforms = {
    uTime:   { value: 0 },
    uInner:  { value: 1.5 },
    uOuter:  { value: 4 },
    uBright: { value: 1 },
    uHot:    { value: new THREE.Color() },
    uMid:    { value: new THREE.Color() },
    uCool:   { value: new THREE.Color() },
  };
  let diskGeometry = null;
  const diskMaterial = new THREE.ShaderMaterial({
    uniforms: diskUniforms,
    vertexShader: DISK_VERTEX,
    fragmentShader: DISK_FRAGMENT,
    transparent: true,
    depthWrite: false,                                     // the star hides the far side (depth test)
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const disk = new THREE.Mesh(new THREE.BufferGeometry(), diskMaterial);
  disk.rotation.x = -Math.PI / 2;                          // ring geometry lies in xy: turn it into the equator
  disk.renderOrder = 1;                                    // after the cut faces, so its near side passes in front of them
  pivot.add(disk);

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
    surfaceUniforms.uPattern.value = preset.pattern ?? 0;
    surfaceUniforms.uPatStrength.value = opts.textureStrength;
    surfaceUniforms.uPatScale.value = opts.textureScale ?? preset.scale ?? 3;

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

    // ---- the accretion disk ----
    disk.visible = !!opts.disk;
    if (opts.disk) {
      const inner = Math.max(1, opts.diskInner), outer = Math.max(inner + 0.2, opts.diskOuter);
      if (!diskGeometry || diskGeometry.parameters.outerRadius !== outer) {
        diskGeometry?.dispose();
        diskGeometry = new THREE.RingGeometry(0.9, outer, 256, 8);
        disk.geometry = diskGeometry;
      }
      disk.scale.setScalar(opts.radius);
      diskUniforms.uInner.value = inner;
      diskUniforms.uOuter.value = outer;
      diskUniforms.uBright.value = opts.diskBrightness;
      const cols = Array.isArray(opts.diskColors) ? opts.diskColors : String(opts.diskColors).split(',');
      ['uHot', 'uMid', 'uCool'].forEach((u, i) => diskUniforms[u].value.copy(toUniformColor(String(cols[i] ?? cols.at(-1)).trim())));
    }

    // ---- the interior ----
    cutGroup.scale.setScalar(opts.radius);
    faceUniforms.uStarR.value = opts.radius;
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

    applyShape();
  }

  // ---- the four quarters and their ingredients ----
  function applyShape() {
    // What each quarter shows
    const list = (Array.isArray(opts.regions) ? opts.regions : String(opts.regions).split(','))
      .map(x => String(x).trim().toLowerCase()).filter(Boolean);
    const effects = [0, 1, 2, 3].map(i => {
      const name = list.length === 1 ? list[0] : (list[i] ?? 'plain');
      if (!(name in EFFECTS)) console.warn(`createStellar: unknown region "${name}" (use ${Object.keys(EFFECTS).join(', ')})`);
      return EFFECTS[name] ?? 0;
    });
    // Per face: [split?, lower quarter, upper quarter]; split only when the two quarters differ
    const face = (lower, upper) => [lower === upper ? 0 : 1, lower, upper];
    const assign = [face(effects[3], effects[0]), face(effects[2], effects[1])];   // clockwise from upper left
    burningQuarter = effects.indexOf(EFFECTS.burning);

    // Shared settings of the ingredients
    const core = Math.min(0.9, Math.max(0.02, opts.coreRadius));
    faceUniforms.uCoreR.value = core;
    faceUniforms.uCoreShown.value = effects.includes(EFFECTS.burning) ? 1 : 0;
    faceUniforms.uCoreGlow.value = opts.coreGlow;
    faceUniforms.uGlowColor.value.copy(toUniformColor(opts.coreGlowColor));
    faceUniforms.uBurnColor.value.copy(toUniformColor(opts.burningColor));
    faceUniforms.uBurnInk.value.copy(toUniformColor(opts.burningInk));
    faceUniforms.uBurnSpeed.value = opts.burningSpeed;
    faceUniforms.uHydroLayers.value = Math.min(8, Math.max(1, Math.round(opts.hydrostaticLayers)));
    faceUniforms.uPressColor.value.copy(toUniformColor(opts.pressureColor));
    faceUniforms.uGravColor.value.copy(toUniformColor(opts.gravityColor));
    faceUniforms.uWalkSpeed.value = opts.photonSpeed;
    faceUniforms.uWalkColor.value.copy(toUniformColor(opts.photonColor));
    faceUniforms.uQColor.value.copy(toUniformColor(opts.questionColor));
    faceUniforms.uQSize.value = Math.max(0.1, opts.questionSize);

    // Trefoils on an arc in the core of the burning region, spaced so that they do not overlap
    const n = Math.min(MAX_TREFOILS, Math.max(0, Math.round(opts.burningSymbols)));
    const regionSpan = Math.PI / 2;                        // a quarter of a disc
    const ring = n === 1 ? 0.45 * core : 0.6 * core;
    const gap = n > 1 ? ring * regionSpan * 0.9 / n : core;
    faceUniforms.uTrefN.value = n;
    faceUniforms.uTrefSize.value = Math.min(opts.burningSize, 0.55 * gap, 0.38 * core);

    // Photons start at the edge of the core and walk out to the surface
    faceUniforms.uWalkN.value = Math.min(6, Math.max(0, Math.round(opts.photonWalks)));
    faceUniforms.uWalkFrom.value = core + 0.01;

    // Acoustic rays: traced once per set of options, drawn into a texture every frame while open
    const wantRays = effects.includes(EFFECTS.rays);
    const rayKey = wantRays ? JSON.stringify([opts.rays, opts.rayFrequencies, opts.rayOmega, opts.rayTrail, opts.raySpeed, opts.rayColors, opts.rayWidth, opts.rayLoop]) : null;
    if (rayKey !== rayState.key) {
      rayState.texture?.dispose();
      rayState.painter = rayState.texture = null;
      if (wantRays) {
        const modes = (Array.isArray(opts.rays) ? opts.rays : String(opts.rays).split(',')).map(Number).filter(Number.isFinite);
        rayState.painter = createRayPainter({
          modes, frequencies: [].concat(opts.rayFrequencies ?? 1).map(Number), omega: opts.rayOmega, trail: opts.rayTrail, speed: opts.raySpeed, width: opts.rayWidth, loop: opts.rayLoop,
          ...(opts.rayColors ? { colors: Array.isArray(opts.rayColors) ? opts.rayColors : String(opts.rayColors).split(',').map(c => c.trim()) } : {}),
        });
        rayState.texture = new THREE.CanvasTexture(rayState.painter.canvas);
        rayState.texture.colorSpace = THREE.NoColorSpace;  // colors exactly as written, like the rest
        rayState.texture.generateMipmaps = false;
        rayState.texture.minFilter = THREE.LinearFilter;
      }
      rayState.key = rayKey;
      rayState.clock = 0;
    }
    if (rayState.painter) {                                // the texture: about one texel per screen pixel
      rayState.painter.setSize(opts.radius * opts.height * renderer.getPixelRatio() / RAY_DISC);
      rayState.painter.draw(rayState.clock);
      rayState.texture.needsUpdate = true;
    }
    faceUniforms.uRayTex.value = rayState.texture;

    faces.forEach((f, i) => {
      const u = f.material.uniforms;
      u.uSide.value = i === 0 ? -1 : 1;                    // face1 is on the left of the opening
      u.uRayTex.value = rayState.texture;
      u.uThC.value = 0;                                    // a half disc: centred on the equator ...
      u.uThS.value = Math.PI;                              // ... reaching from pole to pole
      [u.uSplit.value, u.uEffA.value, u.uEffB.value] = assign[i];
    });
    applyShown();
  }

  // ---- showing the quarters one by one ----
  // shown[i]: how far quarter i (clockwise from the upper left) shows its ingredient, 0..1;
  // each frame it moves towards shownTarget[i]. All shown unless showQuarters() says otherwise.
  const FACE_QUARTERS = [[3, 0], [2, 1]];                  // per face: [lower, upper] quarter
  const rayState = { key: null, painter: null, texture: null, clock: 0 };
  const QUARTER_FADE = 0.6;                                // seconds
  let burningQuarter = -1;
  const shown = [1, 1, 1, 1];
  const shownTarget = [1, 1, 1, 1];
  let pendingRegions = null;                               // swapRegions(): the interior to show once the old one has faded

  function applyShown() {
    faces.forEach((f, i) => {
      f.material.uniforms.uShowA.value = shown[FACE_QUARTERS[i][0]];
      f.material.uniforms.uShowB.value = shown[FACE_QUARTERS[i][1]];
    });
    faceUniforms.uCoreFade.value = burningQuarter >= 0 ? shown[burningQuarter] : 0;
  }

  // The first `count` quarters (clockwise from the upper left) show their ingredients, the others are plain
  function showQuarters(count, snap = false) {
    for (let i = 0; i < 4; i++) {
      shownTarget[i] = i < count ? 1 : 0;
      if (snap || frameId === null) shown[i] = shownTarget[i];
    }
    applyShown();
    if (frameId === null) renderer.render(scene, camera);
  }

  // Change what the inside shows (option regions): the old ingredients fade out, the new ones fade in
  function swapRegions(regions, snap = false) {
    const key = r => String(r ?? '');
    if (key(regions) === key(pendingRegions ?? opts.regions)) return;
    if (snap || frameId === null) {
      pendingRegions = null;
      opts.regions = regions;
      applyShape();
      if (frameId === null) renderer.render(scene, camera);
    } else {
      pendingRegions = regions;                            // the animation loop does the rest
    }
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
    surfaceUniforms.uFlow.value += dt * opts.textureSpeed;
    surfaceUniforms.uTime.value = boil;
    glowUniforms.uTime.value += dt;                        // slow drift of the corona streaks

    arrowTime += dt * opts.arrowSpeed;
    faceUniforms.uArrowTime.value = arrowTime;
    faceUniforms.uTime.value += dt;
    diskUniforms.uTime.value += dt * opts.diskSpeed;

    // Opening / closing the wedge
    if (opts.cut && cutProgress !== cutTarget) {
      const step = opts.cutAnimate ? dt / Math.max(0.01, opts.cutDuration) : 1;
      cutProgress = cutTarget > cutProgress ? Math.min(cutTarget, cutProgress + step)
                                            : Math.max(cutTarget, cutProgress - step);
      applyCut();
    }

    // The acoustic rays travel while the star is open, and start again from the surface each time it opens
    if (rayState.painter) {
      if (cutGroup.visible) {
        rayState.clock += dt;
        rayState.painter.draw(rayState.clock);
        rayState.texture.needsUpdate = true;
      } else rayState.clock = 0;
    }

    // Quarters fading in / out (while the regions are being swapped: out first, then in with the new ones)
    if (pendingRegions !== null && (shown.every(v => v === 0) || !cutGroup.visible)) {
      opts.regions = pendingRegions;
      pendingRegions = null;
      applyShape();
    }
    const targetOf = i => pendingRegions !== null ? 0 : shownTarget[i];
    if (shown.some((v, i) => v !== targetOf(i))) {
      const step = dt / QUARTER_FADE;
      for (let i = 0; i < 4; i++) {
        const target = targetOf(i);
        shown[i] = target > shown[i] ? Math.min(target, shown[i] + step) : Math.max(target, shown[i] - step);
      }
      applyShown();
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
    showQuarters,                                          // showQuarters(n, snap): the first n quarters (clockwise from upper left)
    swapRegions,                                           // swapRegions(regions, snap): a new inside, faded over
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
      faces.forEach(f => f.material.dispose());
      rayState.texture?.dispose();
      glowGeometry.dispose();
      glowMaterial.dispose();
      diskGeometry?.dispose();
      diskMaterial.dispose();
      renderer.domElement.remove();
    }
  };
}
