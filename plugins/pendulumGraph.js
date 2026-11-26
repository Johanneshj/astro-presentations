// plugins/pendulumGraph.js
//
// "Imagine we measured the pendulum": the bob's position x(t) = A cos(2 pi t / T) as measured points
// that appear one by one, traced by a ball. A standalone routine (it does not use graph.js).
//
//   <div class="pendulum-graph" data-amplitude="1" data-period="2">
//     <span class="fragment fade-in" data-show="period">Period <em>T</em> = 2 s</span>
//     <span class="fragment fade-in" data-show="amplitude">Amplitude <em>A</em> = 1 m</span>
//   </div>
//
// The two children are ordinary reveal fragments: reveal fades them in on "next" and out on "back",
// with any fragment style (fade-in, fade-up, zoom-in, ...) and data-fragment-index. This routine only
// puts them in the right place and draws their arrows. Leave one out and it is not shown.
// Placing them: data-from (period: which peak it starts at), data-at (amplitude: which peak),
// data-y (period: height of the arrow, in y units), data-label (above / below / left / right of
// the arrow), data-dx / data-dy (nudge the label, px).
// All attributes: docs/pendulum-graph.md
import { bool, numberList, readOptions, reserveSize, manageSlideItems } from './lib/revealHelpers.js';

const ATTRIBUTES = {
  width:          ['width',          Number],
  height:         ['height',         Number],
  amplitude:      ['amplitude',      Number],
  period:         ['period',         Number],
  t:              ['tRange',         numberList],   // data-t="0,8": time axis from 0 to 8 s
  dt:             ['dt',             Number],       // seconds between measured points
  y:              ['yRange',         numberList],
  xStep:          ['xStep',          Number],
  yStep:          ['yStep',          Number],
  xLabel:         ['xLabel',         String],
  yLabel:         ['yLabel',         String],
  speed:          ['speed',          Number],
  pointColor:     ['pointColor',     String],
  pointRadius:    ['pointRadius',    Number],
  ball:           ['ball',           bool],
  ballColor:      ['ballColor',      String],
  ballRadius:     ['ballRadius',     Number],
  axisColor:      ['axisColor',      String],
  axisWidth:      ['axisWidth',      Number],
  zeroLine:       ['zeroLine',       bool],
  fontSize:       ['fontSize',       Number],
  tickFontSize:   ['tickFontSize',   Number],
  padding:        ['padding',        numberList],
  periodFrom:     ['periodFrom',     Number],       // the period arrow runs from peak n to peak n + 1
  amplitudeAt:    ['amplitudeAt',    Number],       // the amplitude arrow stands on peak n
  periodColor:    ['periodColor',    String],
  amplitudeColor: ['amplitudeColor', String],
  arrowWidth:     ['arrowWidth',     Number],
};

const DEFAULTS = {
  width: 1100, height: 480,
  amplitude: 1,                   // A, in the units of the y axis
  period: 2,                      // T, seconds (match the pendulum slide's data-period)
  tRange: [0, 8],
  dt: 0.05,
  yRange: null,                   // null = A * [-1.4, 1.4]
  xStep: 1,
  yStep: null,                    // null = A / 2
  xLabel: 'Time [s]',
  yLabel: '<em>x</em> [m]',       // HTML allowed
  speed: 1,                       // 1 = real time: the ball moves exactly like the pendulum
  pointColor: '#9aa7b8',
  pointRadius: 4,
  ball: true,
  ballColor: '#ff5e5e',           // same red as the pendulum's bob
  ballRadius: 9,
  axisColor: '#ffffff',
  axisWidth: 3,
  zeroLine: true,
  fontSize: 26,
  tickFontSize: 18,
  padding: [40, 30, 80, 100],     // top, right, bottom, left (px) around the plot
  periodFrom: 1,                  // peaks are at t = 0, T, 2T, ... : arrow from T to 2T
  amplitudeAt: 3,                 // amplitude arrow at t = 3T
  periodColor: '#ffd166',
  amplitudeColor: '#50fa7b',
  arrowWidth: 3.5,
};

const SVG = 'http://www.w3.org/2000/svg';

function svgEl(name, attrs = {}, parent = null) {
  const el = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (parent) parent.appendChild(el);
  return el;
}

function formatTick(v, step) {
  if (Math.abs(v) < step * 1e-6) return '0';
  const decimals = Math.max(0, Math.ceil(-Math.log10(step) - 1e-9));
  return v.toFixed(decimals).replace('-', '−');
}

/** Draw into container; returns { start, stop, restart, dispose }. */
export function createPendulumGraph(container, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const A = o.amplitude, T = o.period;
  const [t0, t1] = o.tRange;
  const [y0, y1] = o.yRange ?? [-1.4 * A, 1.4 * A];
  const yStep = o.yStep ?? A / 2;
  const [pt, pr, pb, pl] = o.padding;
  const W = o.width - pl - pr, H = o.height - pt - pb;
  const X = t => pl + (t - t0) / (t1 - t0) * W;
  const Y = y => pt + H - (y - y0) / (y1 - y0) * H;
  const x = t => A * Math.cos(2 * Math.PI * t / T);     // the bob's position, released at t = 0

  container.style.position = 'relative';
  const svg = svgEl('svg', { width: o.width, height: o.height, viewBox: `0 0 ${o.width} ${o.height}` });
  svg.style.cssText = 'position: absolute; left: 0; top: 0; overflow: visible;';
  container.prepend(svg);

  const id = Math.random().toString(36).slice(2, 8);
  const defs = svgEl('defs', {}, svg);
  function marker(name, color) {
    const m = svgEl('marker', { id: `${name}-${id}`, viewBox: '0 0 10 10', refX: 8, refY: 5,
      markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse' }, defs);
    svgEl('path', { d: 'M 0 1 L 10 5 L 0 9 z', fill: color }, m);
    return `url(#${name}-${id})`;
  }

  // ---- axes, ticks, labels ----
  const axisHead = marker('axis', o.axisColor);
  const axes = svgEl('g', { stroke: o.axisColor, 'stroke-width': o.axisWidth, fill: 'none' }, svg);
  svgEl('polyline', { points: `${pl},${pt - 14} ${pl},${pt + H}`, 'marker-start': axisHead }, axes);
  svgEl('polyline', { points: `${pl},${pt + H} ${pl + W + 14},${pt + H}`, 'marker-end': axisHead }, axes);

  const text = svgEl('g', { fill: o.axisColor, 'font-size': o.tickFontSize, 'font-family': 'inherit' }, svg);
  for (let t = Math.ceil(t0 / o.xStep) * o.xStep; t <= t1 + 1e-9; t += o.xStep) {
    if (X(t) > pl + W - 8) continue;
    svgEl('line', { x1: X(t), y1: pt + H, x2: X(t), y2: pt + H + 10, stroke: o.axisColor, 'stroke-width': 2 }, axes);
    svgEl('text', { x: X(t), y: pt + H + 14 + o.tickFontSize, 'text-anchor': 'middle' }, text)
      .textContent = formatTick(t, o.xStep);
  }
  for (let v = Math.ceil(y0 / yStep) * yStep; v <= y1 + 1e-9; v += yStep) {
    if (Y(v) < pt + 8) continue;
    svgEl('line', { x1: pl, y1: Y(v), x2: pl - 10, y2: Y(v), stroke: o.axisColor, 'stroke-width': 2 }, axes);
    svgEl('text', { x: pl - 16, y: Y(v), 'text-anchor': 'end', 'dominant-baseline': 'central' }, text)
      .textContent = formatTick(v, yStep);
  }
  if (o.zeroLine && y0 < 0 && y1 > 0) {
    svgEl('line', { x1: pl, y1: Y(0), x2: pl + W, y2: Y(0), stroke: 'rgba(255,255,255,0.25)',
      'stroke-width': 1.5, 'stroke-dasharray': '8 6' }, svg);
  }

  // Axis labels as HTML, so <em>x</em> etc. work
  function htmlLabel(html, css) {
    const div = document.createElement('div');
    div.className = 'pendulum-graph-label';
    div.innerHTML = html;
    div.style.cssText = `position: absolute; white-space: nowrap; font-size: ${o.fontSize}px; line-height: 1; ${css}`;
    container.appendChild(div);
    return div;
  }
  const labels = [
    htmlLabel(o.xLabel, `left: ${pl + W / 2}px; top: ${o.height - o.fontSize * 1.2}px; transform: translateX(-50%);`),
    htmlLabel(o.yLabel, `left: ${o.fontSize * 0.2}px; top: ${pt + H / 2}px; transform: translate(-50%, -50%) rotate(-90deg) translateY(${o.fontSize * 0.6}px);`),
  ];

  // ---- measured points and the ball ----
  const points = [];
  const pointGroup = svgEl('g', { fill: o.pointColor }, svg);
  for (let i = 0; t0 + i * o.dt <= t1 + 1e-9; i++) {
    const t = t0 + i * o.dt;
    points.push({ t, el: svgEl('circle', { cx: X(t), cy: Y(x(t)), r: o.pointRadius, opacity: 0 }, pointGroup) });
  }
  const ball = o.ball ? svgEl('circle', { r: o.ballRadius, fill: o.ballColor }, svg) : null;

  // A label beside its arrow: data-label="above | below | left | right", then nudged by
  // data-dx / data-dy (px; dx > 0 = right, dy > 0 = down)
  function placeLabel(label, side, d) {
    const SIDES = {
      above: { left: '50%', bottom: '100%', move: 'translate(-50%, -4px)' },
      below: { left: '50%', top: '100%', move: 'translate(-50%, 4px)' },
      right: { left: 'calc(100% + 8px)', top: '50%', move: 'translateY(-50%)' },
      left:  { right: 'calc(100% + 8px)', top: '50%', move: 'translateY(-50%)' },
    };
    const s = SIDES[side] ?? (console.warn(`pendulum-graph: data-label="${side}" (use above, below, left, right)`), SIDES.above);
    const { move, ...where } = s;
    Object.assign(label.style, where);
    label.style.transform = `${move} translate(${Number(d.dx) || 0}px, ${Number(d.dy) || 0}px)`;
  }

  // ---- the annotations: the author's own fragments, placed and given an arrow ----
  // Positions are worked out here; the fading is left to reveal.
  const placed = [];
  for (const el of container.querySelectorAll(':scope > [data-show]')) {
    const kind = el.dataset.show;
    const color = el.dataset.color ?? (kind === 'period' ? o.periodColor : o.amplitudeColor);
    const head = o.arrowWidth * 3.5;
    const label = document.createElement('span');
    label.className = 'pendulum-graph-annotation-label';
    label.append(...el.childNodes);
    el.replaceChildren();
    el.style.cssText += `position: absolute; display: block; color: ${color}; font-size: ${o.fontSize * 0.85}px;`
      + ' font-weight: bold; line-height: 1; margin: 0;';
    label.style.cssText = 'position: absolute; white-space: nowrap;';
    const arrow = svgEl('svg', {}, null);
    arrow.style.cssText = 'position: absolute; left: 0; top: 0; width: 100%; height: 100%; overflow: visible;';
    const m = marker(`a-${kind}`, color);

    if (kind === 'period') {
      const n = Number(el.dataset.from ?? o.periodFrom);
      const xa = X(n * T), xb = X((n + 1) * T);
      // the arrow's height: data-y (in y-axis units), or just above the peaks
      const top = 'y' in el.dataset ? Y(Number(el.dataset.y)) - head : Y(A) - o.pointRadius - 2.5 * head;
      Object.assign(el.style, { left: `${xa}px`, top: `${top}px`, width: `${xb - xa}px`, height: `${2 * head}px` });
      svgEl('line', { x1: head * 0.6, y1: head, x2: xb - xa - head * 0.6, y2: head, stroke: color,
        'stroke-width': o.arrowWidth, 'marker-start': m, 'marker-end': m }, arrow);
      placeLabel(label, el.dataset.label ?? 'above', el.dataset);
    } else if (kind === 'amplitude') {
      const n = Number(el.dataset.at ?? o.amplitudeAt);
      const xa = X(n * T);
      Object.assign(el.style, { left: `${xa - head}px`, top: `${Y(A)}px`, width: `${2 * head}px`, height: `${Y(0) - Y(A)}px` });
      svgEl('line', { x1: head, y1: Y(0) - Y(A), x2: head, y2: head * 0.6, stroke: color,
        'stroke-width': o.arrowWidth, 'marker-end': m }, arrow);
      placeLabel(label, el.dataset.label ?? 'right', el.dataset);
    } else {
      console.warn(`pendulum-graph: unknown data-show="${kind}" (use period or amplitude)`);
    }
    el.append(arrow, label);
    placed.push(el);
  }

  // ---- animation: real time, the ball follows x(t) ----
  let frameId = null, start0 = 0, shown = 0;

  function frame(now) {
    const t = Math.min(t1, t0 + (now - start0) / 1000 * o.speed);
    while (shown < points.length && points[shown].t <= t + 1e-9) points[shown++].el.setAttribute('opacity', 1);
    if (ball) { ball.setAttribute('cx', X(t)); ball.setAttribute('cy', Y(x(t))); }
    frameId = t < t1 ? requestAnimationFrame(frame) : null;
  }

  function restart() {
    stop();
    for (const p of points) p.el.setAttribute('opacity', 0);
    shown = 0;
    start0 = performance.now();
    frameId = requestAnimationFrame(frame);
  }

  function showAll() {
    stop();
    for (const p of points) p.el.setAttribute('opacity', 1);
    shown = points.length;
    if (ball) { ball.setAttribute('cx', X(t1)); ball.setAttribute('cy', Y(x(t1))); }
  }

  function stop() {
    if (frameId !== null) cancelAnimationFrame(frameId);
    frameId = null;
  }

  return {
    start() {},                     // nothing runs in the background; restart() traces again
    stop,
    restart,
    showAll,
    dispose() { stop(); svg.remove(); labels.forEach(l => l.remove()); },
  };
}

export const PendulumGraphPlugin = {
  id: 'pendulum-graph',

  init(deck) {
    // Built right away (it is light SVG), so the annotation fragments are in place before reveal
    // lays out the slide; the trace restarts each time the slide is shown.
    const handles = new Map();
    for (const el of deck.getRevealElement().querySelectorAll('.pendulum-graph')) {
      const opts = { ...DEFAULTS, ...readOptions(el, ATTRIBUTES) };
      reserveSize(el, opts.width, opts.height, deck);
      handles.set(el, createPendulumGraph(el, opts));
    }

    manageSlideItems(deck, '.pendulum-graph', {
      maxLive: Infinity,
      create: item => handles.get(item.el),
      onShow: item => item.handle.restart(),
      onPrint: item => item.handle.showAll(),
    });
  },
};
