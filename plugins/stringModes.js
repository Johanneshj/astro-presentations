// js_routines/stringModes.js
// Physics of an ideal, slightly stiff string fixed at both ends, plucked and released from rest.
//   y(s, t) = sum over n of  a_n(t) * sin(n*pi*s),   s = position along the string, 0..1
//   a_n(t)  = b_n * cos(2*pi*f_n*t) * exp(-rate_n * t)

/** Frequency of mode n. B = 0: perfectly harmonic; B > 0: stiffness stretches the overtones. */
export function modeFrequency(n, f1, B = 0) {
  return n * f1 * Math.sqrt(1 + B * n * n);
}

/** Decay rate (1/s) of mode n: the fundamental has e-folding time tau1; higher modes decay faster. */
export function modeDecayRate(n, tau1, slope = 0.5) {
  return (1 + slope * (n - 1)) / tau1;
}

/** Mode amplitudes b_n for a pluck at x0 = xFrac * L with height h, released from rest.
 *  (From the Fourier sine series of the triangle shape: b_n = 2hL^2 sin(n pi x0/L) / (pi^2 n^2 x0 (L - x0)).)
 *  Returns an array where b[n] belongs to mode n (index 0 is unused). */
export function pluckAmplitudes(nModes, xFrac, h) {
  const a = Math.min(0.98, Math.max(0.02, xFrac));          // keep the pluck away from the ends
  const prefactor = 2 * h / (Math.PI * Math.PI * a * (1 - a));
  const b = new Float64Array(nModes + 1);
  for (let n = 1; n <= nModes; n++) {
    b[n] = prefactor * Math.sin(n * Math.PI * a) / (n * n);
  }
  return b;
}

/** Fill out[n] with the amplitude of every mode at time t after the pluck. */
export function modeAmplitudesAt(b, nModes, f1, B, tau1, slope, t, out) {
  for (let n = 1; n <= nModes; n++) {
    out[n] = b[n]
      * Math.cos(2 * Math.PI * modeFrequency(n, f1, B) * t)
      * Math.exp(-modeDecayRate(n, tau1, slope) * t);
  }
}

/** Run from the console:  (await import('./js_routines/stringModes.js')).selfTest() */
export function selfTest() {
  const check = (name, ok, info = '') => console.log(`${ok ? '✅' : '❌'} ${name} ${info}`);
  const h = 10;

  // 1. Pluck at the centre: b_1 = 8h/pi^2, and every even mode vanishes (node at the pluck point)
  let b = pluckAmplitudes(40, 0.5, h);
  check('centre pluck: b1 = 8h/π²', Math.abs(b[1] - 8 * h / (Math.PI ** 2)) < 1e-9, `(got ${b[1].toFixed(6)})`);
  let evenMax = 0;
  for (let n = 2; n <= 40; n += 2) evenMax = Math.max(evenMax, Math.abs(b[n]));
  check('centre pluck: even modes vanish', evenMax < 1e-9 * h, `(largest ${evenMax.toExponential(1)})`);

  // 2. The sum of all modes at t = 0 must reproduce the triangle we started from
  const N = 400;
  b = pluckAmplitudes(N, 0.3, h);
  let worst = 0;
  for (const s of [0.05, 0.15, 0.3, 0.5, 0.7, 0.95]) {
    let y = 0;
    for (let n = 1; n <= N; n++) y += b[n] * Math.sin(n * Math.PI * s);
    const exact = s <= 0.3 ? h * s / 0.3 : h * (1 - s) / 0.7;
    worst = Math.max(worst, Math.abs(y - exact));
  }
  check('plucked shape is reproduced by the modes', worst < 0.02 * h, `(worst error ${worst.toExponential(2)} mm)`);

  // 3. Frequencies and decay
  check('harmonic ladder: f_n = n f_1 when B = 0', Math.abs(modeFrequency(7, 110, 0) - 770) < 1e-9);
  check('stiffness stretches the overtones', modeFrequency(2, 110, 0.001) > 220);
  check('higher modes decay faster', modeDecayRate(5, 4) > modeDecayRate(1, 4));
}