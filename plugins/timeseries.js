// plugins/timeseries.js
//
// Getting a time series into memory, and its amplitude spectrum.
// A series is { t, y, uniform }:  t = times in SECONDS (Float64Array, increasing),
// y = values (Float64Array), uniform = true when the samples are evenly spaced.
//
//   loadSeries(src, options)        text table (.csv .txt .dat .tsv ...) or audio file (.mp3 .wav .ogg ...)
//   seriesFromFunction(expr, ...)   a formula such as "A*sin(2*PI*t/T)"
//   amplitudeSpectrum(series, ...)  -> { f (Hz), a }
//
// Everything is cached, so a time-series slide and the spectrum slide after it share the work.

export const TIME_UNITS = { s: 1, min: 60, h: 3600, d: 86400 };
export const FREQ_UNITS = { Hz: 1, mHz: 1e-3, uHz: 1e-6, 'µHz': 1e-6, 'c/d': 1 / 86400, 'c/h': 1 / 3600 };

// How the units are written on an axis
export const UNIT_LABELS = { uHz: 'µHz', 'c/d': 'd⁻¹', 'c/h': 'h⁻¹' };

const AUDIO_EXTENSIONS = /\.(mp3|wav|ogg|oga|m4a|aac|flac|webm)$/i;
export const isAudioFile = src => AUDIO_EXTENSIONS.test(src.split('?')[0]);

const cache = new Map();          // key -> Promise

function cached(key, make) {
  if (!cache.has(key)) {
    const p = make();
    p.catch(() => cache.delete(key));                       // a failed load may be retried later
    cache.set(key, p);
  }
  return cache.get(key);
}

// ---------- Loading ----------

/**
 * Load a time series from a file.
 * options (text files only):
 *   columns   "0,1" (indices) or "time,flux" (header names): which columns are time and value
 *   timeUnit  unit of the time column: 's' | 'min' | 'h' | 'd'   (default 'd', as in most light curves)
 *   timeZero  'first' (default: the series starts at t = 0) | a number in timeUnit | 'none'
 * Audio files are decoded to their waveform (time in seconds from the start, channels averaged).
 */
export function loadSeries(src, options = {}) {
  const { columns = '0,1', timeUnit = 'd', timeZero = 'first' } = options;
  const key = isAudioFile(src) ? `audio|${src}` : `text|${src}|${columns}|${timeUnit}|${timeZero}`;
  return cached(key, () => isAudioFile(src)
    ? loadAudio(src)
    : loadText(src, columns, timeUnit, timeZero));
}

async function fetchOrThrow(src) {
  let response;
  try {
    response = await fetch(src);
  } catch (err) {
    throw new Error(`could not fetch ${src} (opened as file://? run a local server, see README)`);
  }
  if (!response.ok) throw new Error(`${src}: ${response.status} ${response.statusText}`);
  return response;
}

async function loadAudio(src) {
  const buffer = await (await fetchOrThrow(src)).arrayBuffer();
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const audio = await new Ctx(1, 1, 44100).decodeAudioData(buffer);
  const n = audio.length;
  const y = new Float64Array(n);
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const ch = audio.getChannelData(c);
    for (let i = 0; i < n; i++) y[i] += ch[i] / audio.numberOfChannels;
  }
  const t = new Float64Array(n);
  for (let i = 0; i < n; i++) t[i] = i / audio.sampleRate;
  return { t, y, uniform: true, duration: audio.duration };
}

async function loadText(src, columns, timeUnit, timeZero) {
  const text = await (await fetchOrThrow(src)).text();
  const unit = TIME_UNITS[timeUnit];
  if (!unit) throw new Error(`unknown time unit "${timeUnit}" (use ${Object.keys(TIME_UNITS).join(', ')})`);

  const wanted = String(columns).split(',').map(s => s.trim());
  let header = null;
  let ci = null;                                            // [time column, value column]
  const ts = [], ys = [];

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('%') || line.startsWith('//')) continue;
    const cells = line.split(/[\s,;]+/);
    const nums = cells.map(Number);

    if (ci === null) {
      if (nums.some(Number.isNaN) && !header) {            // a header row with column names
        header = cells.map(c => c.replace(/^["']|["']$/g, '').toLowerCase());
        continue;
      }
      ci = wanted.map(w => {
        if (/^\d+$/.test(w)) return Number(w);
        const idx = header ? header.indexOf(w.toLowerCase()) : -1;
        if (idx < 0) throw new Error(`${src}: no column named "${w}" (header: ${header?.join(', ') ?? 'none'})`);
        return idx;
      });
    }
    const tv = nums[ci[0]], yv = nums[ci[1]];
    if (Number.isFinite(tv) && Number.isFinite(yv)) {       // rows with NaN (gaps, flagged points) are skipped
      ts.push(tv);
      ys.push(yv);
    }
  }
  if (ts.length < 2) throw new Error(`${src}: found fewer than 2 data rows`);

  // Sort by time, in case the file is not
  let order = ts.map((_, i) => i);
  if (ts.some((v, i) => i > 0 && v < ts[i - 1])) order = order.sort((a, b) => ts[a] - ts[b]);

  const zero = timeZero === 'first' ? ts[order[0]] : timeZero === 'none' ? 0 : Number(timeZero) || 0;
  const t = Float64Array.from(order, i => (ts[i] - zero) * unit);
  const y = Float64Array.from(order, i => ys[i]);
  return { t, y, uniform: isUniform(t) };
}

/** Evenly spaced (to 1 %), allowing no gaps? */
function isUniform(t) {
  const dt = (t[t.length - 1] - t[0]) / (t.length - 1);
  for (let i = 1; i < t.length; i++) {
    if (Math.abs(t[i] - t[i - 1] - dt) > 0.01 * dt) return false;
  }
  return true;
}

// ---------- Formulas ----------

const MATH_NAMES = 'sin|cos|tan|asin|acos|atan|sinh|cosh|tanh|sqrt|abs|log|exp|pow|min|max|floor|ceil|round|sign';

/** Turn "A*sin(2*PI*t/T)" into a JavaScript function of t (also accepts x for t).
 *  Allowed: numbers, + - * / ^ ( ), t x A T, PI, E and the usual math functions. */
export function parseFormula(expr, A = 1, T = 1) {
  const js = String(expr)
    .replace(/\^/g, '**')
    .replace(new RegExp(`\\b(${MATH_NAMES})\\b`, 'g'), 'Math.$1')
    .replace(/\b(PI|E)\b/g, 'Math.$1');
  const leftover = js.replace(/Math\.[a-zA-Z]+/g, '').replace(/\b[txAT]\b/g, '');
  if (/[^0-9+\-*/().,\se]/.test(leftover)) throw new Error(`formula "${expr}" contains something not allowed`);
  const f = new Function('t', 'x', 'A', 'T', `return ${js};`);
  return t => f(t, t, A, T);
}

/** Sample a formula from t0 to t1 (seconds) every dt seconds, plus optional Gaussian noise. */
export function seriesFromFunction(expr, { t0 = 0, t1 = 10, dt = 0.05, A = 1, T = 2, noise = 0, seed = 1 } = {}) {
  const fn = parseFormula(expr, A, T);
  const n = Math.max(2, Math.floor((t1 - t0) / dt + 1e-9) + 1);
  const rand = gaussian(seed);
  const t = new Float64Array(n), y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    t[i] = t0 + i * dt;
    y[i] = fn(t[i]) + noise * rand();
  }
  return { t, y, uniform: true };
}

/** Seeded Gaussian random numbers (so the "measured" noise is the same every time). */
function gaussian(seed) {
  let a = seed | 0;
  const uniform = () => {
    a = (a + 0x6D2B79F5) | 0;
    let r = Math.imul(a ^ (a >>> 15), 1 | a);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(uniform() + 1e-12)) * Math.cos(2 * Math.PI * uniform());
}

// ---------- Spectrum ----------

/** In-place radix-2 FFT of (re, im); the length must be a power of 2. */
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {                      // bit-reversal permutation
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr;        im[a] += xi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

const MAX_FFT = 1 << 22;

/**
 * Amplitude spectrum: a sine of amplitude A shows up as a peak of height A.
 * Unevenly sampled data (gaps, as in most light curves) is put on an even grid at the typical
 * cadence, with the gaps filled by zeros (after subtracting the mean). Good enough for a picture.
 * oversample: zero padding factor (finer frequency grid, smoother peaks).
 * Returns { f, a } with f in Hz from 0 to the Nyquist frequency.
 */
export function amplitudeSpectrum(series, { oversample = 4 } = {}) {
  const { t, y } = series;
  const n = t.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += y[i] / n;

  // The grid: typical cadence = median time step
  const steps = new Float64Array(n - 1);
  for (let i = 1; i < n; i++) steps[i - 1] = t[i] - t[i - 1];
  steps.sort();
  let dt = steps[Math.floor(steps.length / 2)] || 1;
  let cells = Math.round((t[n - 1] - t[0]) / dt) + 1;
  while (cells * 2 > MAX_FFT) {                            // very long series: coarser grid
    dt *= 2;
    cells = Math.round((t[n - 1] - t[0]) / dt) + 1;
  }

  const size = Math.min(MAX_FFT, nextPow2(cells * Math.max(1, oversample)));
  const re = new Float64Array(size), im = new Float64Array(size);
  const count = new Uint32Array(cells);
  for (let i = 0; i < n; i++) {                            // average samples that share a cell
    const k = Math.round((t[i] - t[0]) / dt);
    re[k] += y[i] - mean;
    count[k]++;
  }
  let filled = 0;
  for (let k = 0; k < cells; k++) {
    if (count[k] > 1) re[k] /= count[k];
    if (count[k] > 0) filled++;
  }

  fft(re, im);
  const half = size / 2;
  const f = new Float64Array(half), a = new Float64Array(half);
  for (let k = 0; k < half; k++) {
    f[k] = k / (size * dt);
    a[k] = 2 * Math.hypot(re[k], im[k]) / filled;
  }
  return { f, a };
}

function nextPow2(v) {
  let p = 1;
  while (p < v) p <<= 1;
  return p;
}

/** Spectrum of a (loaded) source, cached under key. */
export function cachedSpectrum(key, seriesPromise, options) {
  return cached(`spectrum|${key}|${JSON.stringify(options)}`,
    async () => amplitudeSpectrum(await seriesPromise, options));
}
