// plugins/graph.js
//
// An animated x-y plot on a canvas, for time series and spectra.
//   - draws hundreds of thousands of points smoothly (one min/max segment per pixel column)
//   - "trace" animation: the curve is drawn from left to right, optionally with a ball at its tip,
//     optionally driven by an audio clock so the drawing follows the sound
//   - animated zoom to another x / y window, with ticks that adapt
//   - annotations (arrows, lines, bands, labels) as SVG on top; reveal fades them like any fragment
//
// It only knows about numbers in display units; graphPlugin.js loads the data, converts units and
// connects everything to reveal's fragments. Options: see DEFAULTS below and docs/graph.md.
import { replaceSymbols, pixelRatio } from './lib/revealHelpers.js';

const DEFAULTS = {
  width: 900, height: 450,       // layout size in CSS pixels
  renderScale: 1,                // render-resolution multiplier (the plugin sets it to reveal's slide scale)

  // ---- data window ----
  xRange: null,                  // [min, max] in display units; null = all the data
  yRange: null,                  // [min, max]; null = fit the data in the x window
  window: null,                  // show only this much of x at once (e.g. 10 days); during the trace the
                                 // window moves along with the tip. null = the whole x range
  yFromZero: false,              // automatic y range starts at 0 (spectra)
  yLog: false,                   // logarithmic y axis
  yLogDecades: 4,                // automatic log range: this many decades below the maximum
  yPad: 0.1,                     // automatic range: extra room above / below, as a fraction

  // ---- the curve ----
  style: 'line',                 // 'line' | 'points' | 'both'
  color: '#72d7e9',
  lineWidth: 1.5,
  smooth: true,                  // a smooth curve through the points (when they are further apart than a pixel)
  fill: 0,                      // opacity of the area under the curve (0 = none)
  pointColor: null,              // null = same as color
  pointRadius: 4,
  ball: false,                   // ball at the tip of the trace
  ballColor: '#ff5e5e',          // same red as the pendulum's bob
  ballRadius: 9,

  // ---- animation ----
  animate: 'trace',              // 'trace' = draw from left to right | 'grow' = everything rises from y = 0
                                 // (like a histogram filling up) | 'none' = show at once
  duration: 4,                   // seconds for the trace (the plugin may set it from the audio)
  zoomDuration: 1.2,             // seconds for a zoom

  // ---- axes ----
  axisColor: '#ffffff',
  axisWidth: 3,
  axisArrows: true,
  textColor: null,               // null = the slide's text color
  fontFamily: null,              // null = the slide's font
  fontSize: 26,                  // axis labels
  tickFontSize: 18,
  tickSize: 8,
  ticks: true,
  xStep: null,                   // tick spacing; null = automatic
  yStep: null,
  xLabel: '',
  yLabel: '',
  padding: null,                 // [top, right, bottom, left] in px around the plot; null = automatic
};

export function createGraph(container, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const known = new Set(Object.keys(DEFAULTS).concat('annotations'));
  for (const key of Object.keys(options)) {
    if (!known.has(key)) console.warn(`createGraph: unknown option "${key}"`);
  }
  let annotations = options.annotations ?? [];

  container.style.width = opts.width + 'px';
  container.style.height = opts.height + 'px';
  const canvas = document.createElement('canvas');
  canvas.style.width = opts.width + 'px';
  canvas.style.height = opts.height + 'px';
  // stacking inside the graph: annotations with behind: true (z 0), the data (z 1), the others (z 2)
  canvas.style.position = 'relative';
  canvas.style.zIndex = '1';
  container.style.isolation = 'isolate';
  container.prepend(canvas);
  const ctx = canvas.getContext('2d');

  const css = getComputedStyle(container);
  const font = () => opts.fontFamily ?? css.fontFamily ?? 'sans-serif';
  const textColor = () => opts.textColor ?? css.color ?? '#fff';

  let ratio = 1;
  function resize() {
    ratio = pixelRatio(opts.renderScale, opts.width, opts.height);
    canvas.width = Math.round(opts.width * ratio);
    canvas.height = Math.round(opts.height * ratio);
  }

  // ---------- state ----------
  let data = null;                       // { x, y } in display units, x increasing
  let message = { text: 'loading…', error: false };

  // The view: what is shown now (cur), and where a zoom is heading (from -> to over [t0, t0 + dur])
  let view = null;                       // { x: [a, b], y: [c, d], xStep, yStep }
  let zoom = null;                       // { from, to, t0, dur }

  // Trace: 'empty' (waiting for play) | 'tracing' | 'full'
  let trace = { state: 'full', x0: 0, x1: 1, head: 0, t0: 0, duration: 1, clock: null };

  let dirty = true;

  // ---------- coordinates ----------
  function plotRect() {
    const p = opts.padding;
    if (p) return { L: p[3], T: p[0], W: opts.width - p[1] - p[3], H: opts.height - p[0] - p[2] };
    const L = (opts.yLabel ? opts.fontSize * 1.5 : 0) + (opts.ticks ? opts.tickFontSize * 3.2 + opts.tickSize : 0) + 12;
    const B = (opts.xLabel ? opts.fontSize * 1.6 : 0) + (opts.ticks ? opts.tickFontSize * 1.5 + opts.tickSize : 0) + 10;
    const T = 24, R = 28;
    return { L, T, W: opts.width - L - R, H: opts.height - T - B };
  }

  const fy = v => opts.yLog ? Math.log10(Math.max(v, 1e-300)) : v;

  function mapper(v = view) {
    const { L, T, W, H } = plotRect();
    const [x0, x1] = v.x;
    const y0 = fy(v.y[0]), y1 = fy(v.y[1]);
    return {
      X: x => L + (x - x0) / (x1 - x0) * W,
      Y: y => T + H - (fy(y) - y0) / (y1 - y0) * H,
    };
  }

  // Steps much longer than the typical one are gaps in the data; the line is not drawn across them
  let gapStep = Infinity;
  function typicalStep(x) {
    const n = Math.min(x.length - 1, 2000);
    if (n < 1) return Infinity;
    const stride = Math.max(1, Math.floor((x.length - 1) / n));
    const steps = [];
    for (let i = 1; i < x.length; i += stride) steps.push(x[i] - x[i - 1]);
    steps.sort((a, b) => a - b);
    return steps[steps.length >> 1] || Infinity;
  }

  // First index with x[i] >= v (binary search)
  function lowerBound(arr, v) {
    let lo = 0, hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] < v) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  function valueAt(x) {
    const { x: X, y: Y } = data;
    const i = Math.min(X.length - 1, Math.max(1, lowerBound(X, x)));
    const f = (x - X[i - 1]) / ((X[i] - X[i - 1]) || 1);
    return Y[i - 1] + Math.min(1, Math.max(0, f)) * (Y[i] - Y[i - 1]);
  }

  // ---------- automatic ranges ----------
  function fullX() {
    return data ? [data.x[0], data.x[data.x.length - 1]] : [0, 1];
  }

  function autoY(xr) {
    if (!data) return [0, 1];
    const i0 = lowerBound(data.x, xr[0]);
    const i1 = Math.min(data.x.length, lowerBound(data.x, xr[1]) + 1);
    let lo = Infinity, hi = -Infinity;
    for (let i = i0; i < i1; i++) {
      const v = data.y[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (!Number.isFinite(lo)) return [0, 1];
    if (opts.yLog) {
      const top = hi > 0 ? hi : 1;
      return [top / 10 ** opts.yLogDecades, top * 2];
    }
    if (opts.yFromZero) lo = Math.min(0, lo);
    if (hi === lo) { hi += 1; lo -= 1; }
    const pad = (hi - lo) * opts.yPad;
    return [opts.yFromZero && lo === 0 ? 0 : lo - pad, hi + pad];
  }

  function initialView() {
    const x = opts.xRange ?? fullX();
    return { x, y: opts.yRange ?? autoY(x), xStep: opts.xStep, yStep: opts.yStep };
  }

  /** Target view: null = the starting view; otherwise { x, y, xStep, yStep } (y null = fit). */
  function resolveView(target) {
    if (!target) return initialView();
    const x = target.x ?? opts.xRange ?? fullX();
    return { x, y: target.y ?? autoY(x), xStep: target.xStep ?? null, yStep: target.yStep ?? null };
  }

  /** The part of the view that is drawn: all of it, or a window of opts.window that follows the trace.
   *  The y range stays that of the whole view, so the axis does not jump while the window moves. */
  function windowView() {
    const w = opts.window;
    if (!w || !view || w >= view.x[1] - view.x[0]) return view;
    const [a, b] = view.x;
    let lo;
    if (trace.state === 'empty') lo = a;                                  // waiting: the beginning
    else if (trace.state === 'tracing' && opts.animate === 'trace') lo = trace.head - w;   // tip at the right edge
    else lo = b - w;                                                      // finished: the last stretch
    lo = Math.min(Math.max(lo, a), b - w);
    return { ...view, x: [lo, lo + w] };
  }

  // ---------- ticks ----------
  function niceStep(range, target = 6) {
    const rough = range / target;
    const mag = 10 ** Math.floor(Math.log10(rough));
    const r = rough / mag;
    return (r > 5 ? 10 : r > 2.5 ? 5 : r > 1.5 ? 2 : 1) * mag;
  }

  function formatTick(v, step) {
    if (Math.abs(v) < step * 1e-6) return '0';
    const decimals = Math.max(0, Math.min(6, Math.ceil(-Math.log10(step) - 1e-9)));
    return v.toFixed(decimals).replace('-', '−');
  }

  const SUPERSCRIPT = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
  const powerOfTen = k => '10' + String(k).split('').map(c => SUPERSCRIPT[c]).join('');

  // ---------- text ----------
  /** Draw text where *x* is italic and \nu etc. are symbols. align: 'left' | 'center' | 'right'. */
  function drawText(text, x, y, { size = opts.fontSize, color = textColor(), align = 'center', baseline = 'middle', bold = false } = {}) {
    const parts = replaceSymbols(text).split('*');
    const fontFor = i => `${i % 2 ? 'italic ' : ''}${bold ? 'bold ' : ''}${size}px ${font()}`;
    let total = 0;
    parts.forEach((p, i) => { ctx.font = fontFor(i); total += ctx.measureText(p).width; });
    let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = baseline;
    parts.forEach((p, i) => {
      ctx.font = fontFor(i);
      ctx.fillText(p, cx, y);
      cx += ctx.measureText(p).width;
    });
  }

  function arrowHead(x, y, angle, size, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-size, size * 0.55);
    ctx.lineTo(-size, -size * 0.55);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  // ---------- drawing ----------
  function drawAxes(m) {
    const { L, T, W, H } = plotRect();
    const c = opts.axisColor;
    const aw = opts.axisWidth;
    const head = opts.axisArrows ? aw * 4 : 0;

    ctx.strokeStyle = c;
    ctx.lineWidth = aw;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(L, T - head * 0.5);
    ctx.lineTo(L, T + H);
    ctx.lineTo(L + W + head * 0.5, T + H);
    ctx.stroke();
    if (opts.axisArrows) {
      arrowHead(L, T - head * 1.5, -Math.PI / 2, head, c);
      arrowHead(L + W + head * 1.5, T + H, 0, head, c);
    }

    if (opts.ticks) {
      ctx.lineWidth = Math.max(1.5, aw * 0.6);
      const tickLen = opts.tickSize + aw / 2;

      // x ticks
      const xr = view.x[1] - view.x[0];
      let xs = view.xStep ?? niceStep(xr);
      if (xr / xs > 40) xs = niceStep(xr);
      for (let v = Math.ceil(view.x[0] / xs - 1e-9) * xs; v <= view.x[1] + xs * 1e-9; v += xs) {
        const px = m.X(v);
        if (px > L + W - 8) continue;
        ctx.beginPath();
        ctx.moveTo(px, T + H);
        ctx.lineTo(px, T + H + tickLen);
        ctx.stroke();
        drawText(formatTick(v, xs), px, T + H + tickLen + 4, { size: opts.tickFontSize, baseline: 'top' });
      }

      // y ticks
      if (opts.yLog) {
        const k0 = Math.ceil(Math.log10(view.y[0]) - 1e-9), k1 = Math.floor(Math.log10(view.y[1]) + 1e-9);
        const every = Math.max(1, Math.ceil((k1 - k0 + 1) / 7));
        for (let k = k0; k <= k1; k += every) {
          const py = m.Y(10 ** k);
          if (py < T + 8) continue;
          ctx.beginPath();
          ctx.moveTo(L, py);
          ctx.lineTo(L - tickLen, py);
          ctx.stroke();
          drawText(powerOfTen(k), L - tickLen - 6, py, { size: opts.tickFontSize, align: 'right' });
        }
      } else {
        const yr = view.y[1] - view.y[0];
        let ys = view.yStep ?? niceStep(yr, 5);
        if (yr / ys > 30) ys = niceStep(yr, 5);
        for (let v = Math.ceil(view.y[0] / ys - 1e-9) * ys; v <= view.y[1] + ys * 1e-9; v += ys) {
          const py = m.Y(v);
          if (py < T + 8) continue;
          ctx.beginPath();
          ctx.moveTo(L, py);
          ctx.lineTo(L - tickLen, py);
          ctx.stroke();
          drawText(formatTick(v, ys), L - tickLen - 6, py, { size: opts.tickFontSize, align: 'right' });
        }
      }
    }

    // axis labels
    if (opts.xLabel) {
      drawText(opts.xLabel, L + W / 2, opts.height - 4, { baseline: 'bottom' });
    }
    if (opts.yLabel) {
      ctx.save();
      ctx.translate(opts.fontSize * 0.7, T + H / 2);
      ctx.rotate(-Math.PI / 2);
      drawText(opts.yLabel, 0, 0);
      ctx.restore();
    }
  }

  function drawCurve(m) {
    const { L, T, W, H } = plotRect();
    const { x: X, y: Y } = data;
    const tracing = trace.state === 'tracing';
    const growing = tracing && opts.animate === 'grow';
    const xEnd = tracing && !growing ? Math.min(view.x[1], trace.head) : view.x[1];

    // 'grow': every value is scaled from the baseline (0, or the bottom of a log axis) up to its height
    const g = growing ? ease(trace.p) : 1;
    const bottom = view.y[0] > 0 ? view.y[0] : 1e-300;
    const grow = g >= 1 ? (v => v) : opts.yLog ? (v => bottom * Math.pow(Math.max(v, bottom) / bottom, g)) : (v => v * g);
    if (trace.state === 'empty') return;

    const i0 = Math.max(0, lowerBound(X, view.x[0]) - 1);
    const i1 = Math.min(X.length - 1, lowerBound(X, xEnd));   // one past the end, for continuity
    if (i1 <= i0) return;

    const pad = Math.max(opts.pointRadius, opts.lineWidth) + 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(L, T - pad, W + pad, H + 2 * pad);
    ctx.clip();

    const showLine = opts.style !== 'points';
    const showPoints = opts.style !== 'line';
    const lastX = Math.min(xEnd, X[i1]);

    // Line and fill. The points are first gathered per pixel column (first, lowest, highest, last value).
    // The columns are screen pixels (not slide pixels, which are 2-3 screen pixels on a big monitor) and
    // they are fixed to the data, not to the screen: a scrolling window then keeps the same points in
    // the same column from frame to frame, so the line does not shimmer as it moves.
    //  - sparse data (fewer points than columns): one polyline through them, as usual
    //  - dense data (spectra, long series): each column becomes one short vertical stroke covering its
    //    range (joined to the previous column's last value). That looks the same as the zig-zag line but
    //    has no joints to compute - a zig-zag of tens of thousands of points is very slow to draw.
    if (showLine || opts.fill > 0) {
      const cols = [];                                     // [x, first, top, bottom, last, startsAfterGap]
      const colWidth = (view.x[1] - view.x[0]) / Math.max(1, W * ratio);   // data x per screen pixel
      let col = null, cur = null, jump = false;
      for (let i = i0; i <= i1; i++) {
        let xi = X[i], yi = grow(Y[i]);
        if (i === i1 && xi > lastX) { yi = grow(valueAt(lastX)); xi = lastX; }   // stop exactly at the trace head
        const px = m.X(xi), py = m.Y(yi);
        const c = Math.floor(xi / colWidth);               // screen-pixel columns, fixed to the data
        const gap = i > i0 && xi - X[i - 1] > gapStep;     // a gap in the data: lift the pen
        if (gap) jump = true;
        if (c !== col || gap) {
          cur = [px, py, py, py, py, jump];
          cols.push(cur);
          col = c; jump = false;
        } else {
          if (py < cur[2]) cur[2] = py;
          if (py > cur[3]) cur[3] = py;
          cur[4] = py;
        }
      }
      const dense = i1 - i0 > 3 * cols.length;             // more than 3 points per screen pixel

      if (opts.fill > 0 && cols.length > 1) {              // area under the curve: a plain outline of the column tops
        const base = opts.yLog ? T + H : Math.min(T + H, Math.max(T, m.Y(0)));
        ctx.beginPath();
        ctx.moveTo(cols[0][0], base);
        for (const c of cols) ctx.lineTo(c[0], dense ? c[2] : c[1]);
        ctx.lineTo(cols[cols.length - 1][0], base);
        ctx.closePath();
        ctx.globalAlpha = opts.fill;
        ctx.fillStyle = opts.color;
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      if (showLine && cols.length) {
        ctx.beginPath();
        if (dense) {
          // Columns whose values stay within about a line width are smooth at this scale: one point each,
          // joined into a line (a staircase of strokes would look jagged on slopes). Columns that span
          // more (spikes, oscillations faster than a pixel) get a vertical stroke covering their range.
          const thin = opts.lineWidth * 1.5;
          let prev = null;                                 // [x, y] where the previous column ended
          let joined = false;                              // is the pen at the end of a line?
          for (const c of cols) {
            const after = prev && !c[5];
            if (c[3] - c[2] <= thin) {
              const y = (c[2] + c[3]) / 2;
              if (joined && after) ctx.lineTo(c[0], y);
              else if (after) { ctx.moveTo(prev[0], prev[1]); ctx.lineTo(c[0], y); }
              else ctx.moveTo(c[0], y);
              prev = [c[0], y];
              joined = true;
            } else {
              const from = after ? Math.min(c[2], prev[1]) : c[2];
              const to = after ? Math.max(c[3], prev[1]) : c[3];
              ctx.moveTo(c[0], from);
              ctx.lineTo(c[0], to + 0.01);                 // + 0.01: never a zero-length stroke
              prev = [c[0], c[4]];
              joined = false;
            }
          }
          ctx.lineCap = 'round';                           // round ends close the steps between columns
          ctx.lineJoin = 'round';
        } else if (opts.smooth && i1 - i0 < cols.length) {
          // Points further apart than a pixel: a smooth curve through them (Catmull-Rom as Bezier pieces)
          let run = [];
          const flush = () => {
            if (!run.length) return;
            ctx.moveTo(run[0][0], run[0][1]);
            for (let k = 0; k < run.length - 1; k++) {
              const p0 = run[k - 1] ?? run[k], p1 = run[k], p2 = run[k + 1], p3 = run[k + 2] ?? p2;
              ctx.bezierCurveTo(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6,
                                p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]);
            }
            run = [];
          };
          for (const c of cols) {
            if (c[5]) flush();
            run.push([c[0], c[1]]);
            if (c[4] !== c[1]) run.push([c[0], c[4]]);
          }
          flush();
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
        } else {
          cols.forEach((c, k) => {
            if (k === 0 || c[5]) ctx.moveTo(c[0], c[1]); else ctx.lineTo(c[0], c[1]);
            if (c[2] !== c[1] || c[3] !== c[1]) { ctx.lineTo(c[0], c[2]); ctx.lineTo(c[0], c[3]); }
            ctx.lineTo(c[0], c[4]);
          });
          ctx.lineCap = 'butt';
          ctx.lineJoin = 'round';
        }
        ctx.strokeStyle = opts.color;
        ctx.lineWidth = opts.lineWidth;
        ctx.stroke();
        ctx.lineCap = 'butt';
      }
    }

    // Points (only when there are not too many to see them anyway)
    if (showPoints && i1 - i0 < 5000) {
      ctx.fillStyle = opts.pointColor ?? opts.color;
      for (let i = i0; i <= i1; i++) {
        if (X[i] < view.x[0] || X[i] > xEnd) continue;
        ctx.beginPath();
        ctx.arc(m.X(X[i]), m.Y(grow(Y[i])), opts.pointRadius, 0, 2 * Math.PI);
        ctx.fill();
      }
    }
    ctx.restore();

    // Ball at the tip of the trace
    if (opts.ball && trace.state !== 'empty' && xEnd >= view.x[0]) {
      const bx = Math.min(xEnd, X[X.length - 1]);
      ctx.beginPath();
      ctx.arc(m.X(bx), m.Y(grow(valueAt(bx))), opts.ballRadius, 0, 2 * Math.PI);
      ctx.fillStyle = opts.ballColor;
      ctx.fill();
    }
  }

  // ---------- annotations ----------
  // Each annotation lives in its own element (the child element written in the HTML), which holds an
  // SVG drawing of it on top of the canvas. Showing and hiding is left to reveal: a child with
  // class="fragment" is faded by reveal like any other fragment. Here we only (re)draw the shapes
  // whenever the view changes (zoom), so they stay attached to the data.
  const SVGNS = 'http://www.w3.org/2000/svg';
  let annotationsKey = '';

  function svgEl(name, attrs, parent) {
    const el = document.createElementNS(SVGNS, name);
    for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) el.setAttribute(k, v);
    parent.appendChild(el);
    return el;
  }

  // Text with *italic* parts and \name symbols, as an SVG <text>
  function svgText(parent, text, x, y, { size, color, anchor = 'middle', baseline = 'central', bold = true }) {
    const t = svgEl('text', { x, y, fill: color, 'font-size': size, 'font-family': font(), 'text-anchor': anchor,
      'dominant-baseline': baseline, 'font-weight': bold ? 'bold' : 'normal' }, parent);
    replaceSymbols(text).split('*').forEach((part, i) => {
      if (part) svgEl('tspan', { 'font-style': i % 2 ? 'italic' : 'normal' }, t).textContent = part;
    });
    return t;
  }

  function annotationHost(a) {
    if (!a.el) {                                   // created from JavaScript: make an element for it
      a.el = document.createElement('span');
      container.appendChild(a.el);
    }
    if (!a.svg) {
      a.el.replaceChildren();
      a.el.style.cssText += 'position: absolute; left: 0; top: 0; width: 100%; height: 100%;'
        + ' overflow: visible; pointer-events: none;';
      a.el.style.zIndex = a.behind ? '0' : '2';     // behind: the data's line and fill are drawn over it
      a.svg = document.createElementNS(SVGNS, 'svg');
      a.svg.setAttribute('width', opts.width);
      a.svg.setAttribute('height', opts.height);
      a.svg.style.cssText = 'position: absolute; left: 0; top: 0; overflow: visible;';
      a.el.appendChild(a.svg);
    }
    a.svg.replaceChildren();
    return a.svg;
  }

  function drawAnnotations(m) {
    const key = `${view.x}|${view.y}|${annotations.length}`;
    if (key === annotationsKey) return;            // nothing moved
    annotationsKey = key;
    const { L, T, W, H } = plotRect();

    for (const a of annotations) {
      if (a.type === 'zoom') continue;
      const g = annotationHost(a);
      const color = a.color ?? '#ffd166';
      const width = a.width ?? 3;
      const size = a.size ?? opts.fontSize * 0.85;
      const line = (x1, y1, x2, y2, extra = {}) =>
        svgEl('line', { x1, y1, x2, y2, stroke: color, 'stroke-width': width, ...extra }, g);

      if (a.type === 'arrow') {
        const x1 = m.X(a.from[0]), y1 = m.Y(a.from[1]), x2 = m.X(a.to[0]), y2 = m.Y(a.to[1]);
        const heads = a.heads ?? 'end';
        const id = `h${Math.random().toString(36).slice(2, 8)}`;
        const mk = svgEl('marker', { id, viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 4, markerHeight: 4,
          orient: 'auto-start-reverse' }, svgEl('defs', {}, g));
        svgEl('path', { d: 'M 0 1 L 10 5 L 0 9 z', fill: color }, mk);
        line(x1, y1, x2, y2, {
          'marker-start': heads === 'both' || heads === 'start' ? `url(#${id})` : null,
          'marker-end': heads === 'both' || heads === 'end' ? `url(#${id})` : null,
        });
        if (a.label) {
          const off = a.labelOffset ?? [0, -1];             // in label heights, relative to the middle
          const anchor = { left: 'start', right: 'end' }[a.labelAlign] ?? 'middle';
          svgText(g, a.label, (x1 + x2) / 2 + off[0] * size, (y1 + y2) / 2 + off[1] * size, { size, color, anchor });
        }
      } else if (a.type === 'line') {
        const dash = (a.dash ?? [8, 6]).join(' ') || null;
        (a.x ?? []).forEach((xv, i) => {
          if (xv < view.x[0] || xv > view.x[1]) return;
          const px = m.X(xv);
          line(px, T + H, px, T, { 'stroke-dasharray': dash });
          if (a.labels?.[i]) svgText(g, a.labels[i], px, T - 4, { size, color, baseline: 'auto' });
        });
        (a.y ?? []).forEach((yv, i) => {
          if (yv < view.y[0] || yv > view.y[1]) return;
          const py = m.Y(yv);
          line(L, py, L + W, py, { 'stroke-dasharray': dash });
          if (a.labels?.[i]) svgText(g, a.labels[i], L + W - 4, py - 4, { size, color, anchor: 'end', baseline: 'auto' });
        });
      } else if (a.type === 'band') {
        const xa = Math.max(L, m.X(a.x[0])), xb = Math.min(L + W, m.X(a.x[1]));
        const ya = a.y ? m.Y(a.y[1]) : T, yb = a.y ? m.Y(a.y[0]) : T + H;
        if (xb > xa) {
          svgEl('rect', { x: xa, y: ya, width: xb - xa, height: yb - ya, fill: color, 'fill-opacity': a.opacity ?? 0.18,
            stroke: color, 'stroke-width': 1.5 }, g);
          if (a.label) svgText(g, a.label, (xa + xb) / 2, ya - 4, { size, color, baseline: 'auto' });
        }
      } else if (a.type === 'label') {
        const y = a.at[1] === 'top' ? T + size : a.at[1] === 'bottom' ? T + H - size : m.Y(a.at[1]);
        const anchor = { left: 'start', right: 'end' }[a.align] ?? 'middle';
        svgText(g, a.text ?? a.label ?? '', m.X(a.at[0]), y, { size, color, anchor, bold: !!a.bold });
      }
    }
  }

  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

    if (!data) {
      view = view ?? { x: opts.xRange ?? [0, 1], y: opts.yRange ?? [0, 1], xStep: opts.xStep, yStep: opts.yStep };
    }
    // The drawing functions read `view`; with a moving window they draw just that window
    const whole = view;
    view = windowView();
    const m = mapper();
    drawAxes(m);
    if (data) {
      drawCurve(m);
      drawAnnotations(m);
    }
    view = whole;
    if (message) {
      const { L, T, W, H } = plotRect();
      drawText(message.text, L + W / 2, T + H / 2, {
        size: opts.tickFontSize * 1.1, color: message.error ? '#ff7b7b' : textColor(),
      });
    }
  }

  // ---------- animation loop: runs only while something moves ----------
  let frameId = null;
  let last = performance.now();

  const ease = p => p * p * (3 - 2 * p);

  // An audio element's currentTime moves in uneven steps of tens of milliseconds. Fine for the tip of
  // a trace, but a moving window would stutter. So a local clock runs smoothly with the frames and is
  // pulled gently toward the audio's time; it jumps only when they are far apart (a seek, a slow start),
  // and it stands still while the audio's time does (not started yet, paused, finished).
  function smoothClock(now, dt) {
    const c = trace.clock();
    if (c !== trace.clockLast) { trace.clockLast = c; trace.clockChanged = now; }
    const running = now - (trace.clockChanged ?? -Infinity) < 250;
    if (trace.local === undefined || Math.abs(c - trace.local) > 0.3) trace.local = c;
    else {
      if (running) trace.local += dt;
      trace.local += (c - trace.local) * Math.min(1, dt * 0.8);
    }
    return trace.local;
  }

  function animate() {
    frameId = requestAnimationFrame(animate);
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    let moving = false;

    if (zoom) {
      const p = Math.min(1, (now - zoom.t0) / 1000 / zoom.dur);
      const e = ease(p);
      const lerp = (a, b) => a + (b - a) * e;
      const ly = (a, b) => opts.yLog ? 10 ** lerp(Math.log10(a), Math.log10(b)) : lerp(a, b);
      view = {
        x: [lerp(zoom.from.x[0], zoom.to.x[0]), lerp(zoom.from.x[1], zoom.to.x[1])],
        y: [ly(zoom.from.y[0], zoom.to.y[0]), ly(zoom.from.y[1], zoom.to.y[1])],
        xStep: p < 1 ? null : zoom.to.xStep,
        yStep: p < 1 ? null : zoom.to.yStep,
      };
      if (p >= 1) zoom = null;
      moving = true;
    }

    if (trace.state === 'tracing') {
      const elapsed = trace.clock ? smoothClock(now, dt) : (now - trace.t0) / 1000;
      let p = Math.max(0, elapsed / trace.duration);
      if (trace.loop) p -= Math.floor(p);             // looping: start over at the left end
      else p = Math.min(1, p);
      trace.p = p;
      trace.head = trace.x0 + p * (trace.x1 - trace.x0);
      if (p >= 1) trace.state = 'full';
      moving = true;
    }

    if (moving || dirty) {
      draw();
      dirty = false;
    }
  }

  function start() {
    if (frameId !== null) return;
    last = performance.now();
    dirty = true;
    // first frame on the next tick, not now: when a slide is shown again, the plugin resets the
    // trace right after start(), and drawing now would flash the old, finished picture
    frameId = requestAnimationFrame(animate);
  }

  function stop() {
    if (frameId === null) return;
    cancelAnimationFrame(frameId);
    frameId = null;
  }

  resize();
  document.fonts?.ready.then(() => { dirty = true; if (frameId === null) draw(); });
  start();

  return {
    start,
    stop,

    /** Hand over the data: { x, y } in display units, x increasing. */
    setData(d) {
      data = d;
      gapStep = typicalStep(d.x) * 5;                      // more than 5 samples missing = a gap
      message = null;
      view = initialView();
      dirty = true;
    },

    /** Show a message instead of the curve (error = red). */
    setMessage(text, error = false) {
      message = text ? { text, error } : null;
      dirty = true;
    },

    get hasData() { return !!data; },

    /** Zoom: target null = the starting view, or { x: [a, b], y: [c, d] | null, xStep, yStep }.
     *  duration 0 = jump. */
    setView(target, duration = opts.zoomDuration) {
      if (!data) return;
      const to = resolveView(target);
      if (duration <= 0 || frameId === null) {
        view = to;
        zoom = null;
        dirty = true;
        if (frameId === null) draw();
        return;
      }
      zoom = { from: { ...view }, to, t0: performance.now(), dur: duration };
    },

    /** Start the trace over the current x window. duration in seconds; clock() (optional) returns the
     *  elapsed seconds, e.g. from an audio element, so the drawing follows the sound. */
    play({ duration = opts.duration, clock = null, loop = false } = {}) {
      const [x0, x1] = zoom ? zoom.to.x : view ? view.x : [0, 1];
      trace = {
        state: opts.animate === 'trace' || opts.animate === 'grow' ? 'tracing' : 'full',
        p: 0,
        x0, x1, head: x0,
        t0: performance.now(), duration: Math.max(0.01, duration), clock, loop,
      };
      dirty = true;
    },

    /** How far the trace has got (0..1). */
    get progress() { return trace.state === 'empty' ? 0 : trace.p ?? 0; },

    /** Let a running trace follow another clock from here on (null = its own timer), without a jump:
     *  e.g. a sound that starts at the trace's current position. */
    setClock(clock) {
      if (trace.state !== 'tracing') return;
      trace.clock = clock;
      trace.local = trace.clockLast = trace.clockChanged = undefined;
      trace.t0 = performance.now() - trace.p * trace.duration * 1000;
    },

    /** Nothing drawn until play() (for a trace that starts on a later "next"). */
    clear() { trace = { ...trace, state: 'empty' }; dirty = true; },

    /** Everything drawn at once. */
    showAll() { trace = { ...trace, state: 'full' }; dirty = true; },

    get tracing() { return trace.state === 'tracing'; },

    /** The x window shown now, or the one a running zoom is heading to. */
    targetWindow() { return zoom ? zoom.to.x : view ? view.x : [0, 1]; },

    /** Annotations: [{ type: 'arrow' | 'line' | 'band' | 'label', el, ... }] (see docs/graph.md). */
    setAnnotations(list) { annotations = list; annotationsKey = ''; dirty = true; },
    redraw() { dirty = true; if (frameId === null) draw(); },

    /** Change options while it runs (not width / height). */
    set(newOpts) {
      Object.assign(opts, newOpts);
      resize();
      dirty = true;
      if (frameId === null) draw();
    },

    dispose() {
      stop();
      canvas.remove();
    },
  };
}
