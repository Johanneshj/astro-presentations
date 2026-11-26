// js_routines/guitarGeometry.js
// All the numbers that define the look and the layout of the guitar. Model units are
// millimetres; x runs along the guitar (tail -> headstock), y is up.
// This is the file to edit when you tweak the guitar's shape.

export const SCALE_LENGTH = 620;      // vibrating length of an open string, bridge -> nut
export const X_BRIDGE = 220;          // bridge position, measured from the tail tip
export const BODY_END = 500;          // where the body ends and the neck begins (= last outline point)
export const NUM_FRETS = 20;          // frets drawn; the fretboard is cut to fit exactly this many
export const HEADSTOCK_LENGTH = 110;

export const X_NUT = X_BRIDGE + SCALE_LENGTH;           // computed: tail -> nut
export const X_END = X_NUT + HEADSTOCK_LENGTH;          // computed: tail -> tip of the headstock

// Tip: to put the neck-body join at fret N, use X_BRIDGE = BODY_END - SCALE_LENGTH + fretDistance(N)
//      (N = 12 for a classical guitar, 14 for a steel-string guitar).

export const NUT_HALF_WIDTH = 21;            // half the width of the neck at the nut
export const BOARD_END_HALF_WIDTH = 26.5;    // half the width of the fretboard at its body end
export const SOUND_HOLE = { x: 330, r: 46 }; // centre position along the guitar, and radius

/** Distance from the nut to fret n (equal temperament): f ~ 1/L and f rises by 2^(1/12) per fret. */
export function fretDistance(n) {
  return SCALE_LENGTH * (1 - Math.pow(2, -n / 12));
}

// The fretboard ends 12 mm beyond the last fret, so frets always fill the whole board
export const X_FRETBOARD_END = X_NUT - fretDistance(NUM_FRETS) - 12;

/** Half-width of the fretboard at position x: it widens linearly from the nut towards the body. */
export function fretboardHalfWidth(x) {
  const t = (X_NUT - x) / (X_NUT - X_FRETBOARD_END);
  return NUT_HALF_WIDTH + t * (BOARD_END_HALF_WIDTH - NUT_HALF_WIDTH);
}

// Upper half of the body outline, from the tail (x = 0) around to the neck end (x = BODY_END).
// Each point is [x, y]: x = position along the guitar (mm), y = half-width (mm).
// The lower half is the mirror image, added automatically.
export const OUTLINE_UPPER = [
  [0, 0],       // tail tip, on the center line (the very back of the body)
  [10, 62],     // rounded corner of the tail: smaller y = pointier tail, larger = squarer
  [55, 138],    // the lower bout curving outwards
  [120, 180],   // WIDEST POINT of the lower bout (width = 2 x 180 = 360 mm), just behind the bridge
  [195, 172],   // lower bout starting to narrow
  [255, 128],   // the side sweeping in towards the waist
  [300, 112],   // THE WAIST, the narrowest point (width = 2 x 112 = 224 mm)
  [345, 128],   // leaving the waist, the upper bout begins to widen
  [405, 150],   // WIDEST POINT of the upper bout (width = 2 x 150 = 300 mm)
  [460, 128],   // upper bout shoulder rolling in towards the neck
  [492, 70],    // the shoulder meeting the neck
  [BODY_END, 0],// top of the body, on the center line, where the neck attaches
];

// Closed outline: the upper half, then the mirror image walking back to the start
export const OUTLINE = [
  ...OUTLINE_UPPER,
  ...OUTLINE_UPPER.slice(1, -1).reverse().map(([x, y]) => [x, -y]),
];

// Open-string tuning E2 A2 D3 G3 B3 E4 in Hz, low to high
export const TUNING = [82.41, 110.0, 146.83, 196.0, 246.94, 329.63];

// The part of the model that is visible (follows the guitar's length)
export const VIEW = { xMin: -20, xMax: X_END + 20, yMin: -200, yMax: 200 };

/** End points of string i (0 = lowest string, drawn at the bottom). */
export function stringEnds(i) {
  return {
    x0: X_BRIDGE, y0: (i - 2.5) * 11,             // spread wider at the bridge...
    x1: X_NUT,    y1: (i - 2.5) * 7,              // ...than at the nut
  };
}