// plugins/string.js
// A standing wave on a string, suspended between two vertical posts:
//   y(u, t) = A sin(n pi u) cos(2 pi rate t),   u = 0 .. 1 along the string
// n = the mode (1 = the fundamental, 2 = one node in the middle, ...). As a slide element:
// <div class="string" data-mode="2" data-rate="1">, see stringPlugin.js / docs/string.md.
import { pixelRatio, replaceSymbols } from './lib/revealHelpers.js';

export function createString(container, options = {}) {
  const opts = {
    width: 360, height: 120,        // layout size in CSS pixels (the label, if any, goes inside it)
    renderScale: 1,
    mode: 1,                        // n: number of half wavelengths (antinodes) between the posts
    rate: 1,                        // oscillations per second
    amplitude: 0.8,                 // fraction of the room above / below the string
    color: '#72d7e9',
    lineWidth: 3,
    postColor: '#ffffff',
    postWidth: 4,
    postHeight: 0.9,                // fraction of the room the posts span (1 = the full height)
    envelope: true,                 // faint outline of the extreme shapes
    envelopeColor: 'rgba(255, 255, 255, 0.25)',
    nodes: true,                    // small dots at the nodes
    nodeColor: '#ffffff',
    label: '',                      // text below the string; *...* is italic, \name a symbol
    labelColor: '#ffffff',
    fontSize: 20,
    ...options,
  };
  const known = new Set(Object.keys(opts));
  for (const key of Object.keys(options)) {
    if (!known.has(key)) console.warn(`createString: unknown option "${key}"`);
  }

  container.style.width = opts.width + 'px';
  container.style.height = opts.height + 'px';
  const canvas = document.createElement('canvas');
  canvas.style.width = opts.width + 'px';
  canvas.style.height = opts.height + 'px';
  canvas.style.display = 'block';
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const fontFamily = getComputedStyle(container).fontFamily || 'sans-serif';

  let ratio = 1;
  function resize() {
    ratio = pixelRatio(opts.renderScale, opts.width, opts.height);
    canvas.width = Math.round(opts.width * ratio);
    canvas.height = Math.round(opts.height * ratio);
  }

  let time = 0;

  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

    const W = opts.width;
    const labelRoom = opts.label ? opts.fontSize * 1.5 : 0;
    const H = opts.height - labelRoom;                     // the room for posts and string
    const mid = H / 2;
    const pad = opts.postWidth / 2 + 2;
    const x0 = pad, x1 = W - pad, len = x1 - x0;
    const room = 0.5 * H * opts.postHeight;                // posts reach this far above / below the string
    const A = opts.amplitude * (room - opts.lineWidth);
    const n = Math.max(1, Math.round(opts.mode));
    const swing = Math.cos(2 * Math.PI * opts.rate * time);
    const steps = Math.max(64, Math.ceil(len / 2));
    const shape = (s, u) => mid - s * A * Math.sin(n * Math.PI * u);

    // the extreme shapes, faint
    if (opts.envelope) {
      ctx.strokeStyle = opts.envelopeColor;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 5]);
      for (const s of [1, -1]) {
        ctx.beginPath();
        for (let i = 0; i <= steps; i++) {
          const u = i / steps;
          if (i) ctx.lineTo(x0 + u * len, shape(s, u)); else ctx.moveTo(x0, shape(s, u));
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // the posts
    ctx.strokeStyle = opts.postColor;
    ctx.lineWidth = opts.postWidth;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const x of [x0, x1]) { ctx.moveTo(x, mid - room); ctx.lineTo(x, mid + room); }
    ctx.stroke();

    // the string
    ctx.strokeStyle = opts.color;
    ctx.lineWidth = opts.lineWidth;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      if (i) ctx.lineTo(x0 + u * len, shape(swing, u)); else ctx.moveTo(x0, shape(swing, u));
    }
    ctx.stroke();

    // the nodes (where the string never moves), ends included
    if (opts.nodes) {
      ctx.fillStyle = opts.nodeColor;
      for (let k = 0; k <= n; k++) {
        ctx.beginPath();
        ctx.arc(x0 + k / n * len, mid, Math.max(2.5, opts.lineWidth * 0.9), 0, 2 * Math.PI);
        ctx.fill();
      }
    }

    if (opts.label) {
      ctx.fillStyle = opts.labelColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // *italic* parts, drawn one after the other
      const parts = replaceSymbols(opts.label).split('*');
      const fonts = parts.map((_, i) => `${i % 2 ? 'italic ' : ''}${opts.fontSize}px ${fontFamily}`);
      const widths = parts.map((p, i) => { ctx.font = fonts[i]; return ctx.measureText(p).width; });
      let x = W / 2 - widths.reduce((a, b) => a + b, 0) / 2;
      ctx.textAlign = 'left';
      parts.forEach((p, i) => { ctx.font = fonts[i]; ctx.fillText(p, x, opts.height - labelRoom / 2); x += widths[i]; });
    }
  }

  let frameId = null;
  let last = performance.now();

  function animate() {
    frameId = requestAnimationFrame(animate);
    const now = performance.now();
    time += Math.min((now - last) / 1000, 0.1);
    last = now;
    draw();
  }

  function start() {
    if (frameId !== null) return;
    last = performance.now();
    animate();
  }
  function stop() {
    if (frameId === null) return;
    cancelAnimationFrame(frameId);
    frameId = null;
  }

  resize();
  start();

  return {
    start,
    stop,
    reset() { time = 0; if (frameId === null) draw(); },     // back to the start of a swing
    set(newOpts) {
      Object.assign(opts, newOpts);
      resize();
      if (frameId === null) draw();
    },
    dispose() {
      stop();
      canvas.remove();
    },
  };
}
