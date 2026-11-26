// plugins/pendulum.js
// A swinging pendulum on a canvas, with an optional measurement arrow that shows the sideways
// displacement x of the bob. As a slide element: <div class="pendulum" data-...>, see
// pendulumPlugin.js / docs/pendulum.md.
import { pixelRatio, replaceSymbols } from './lib/revealHelpers.js';

export function createPendulum(container, options = {}) {
  const opts = {
    width: 900, height: 520,        // layout size in CSS pixels
    renderScale: 1,
    length: 330,                    // rod length in px
    angle: 30,                      // amplitude in degrees
    period: 2,                      // seconds per full swing
    swinging: true,                 // false = held at the starting angle until release()
    raised: true,                   // false = hanging straight down until raise() lifts it to the starting angle
    raiseDuration: 1.2,             // seconds to lift it (or lower it again)
    pivotY: 30,                     // px from the top
    pivotSize: 16,
    rodWidth: 4,
    bobSize: 44,
    pivotColor: '#333333',
    pivotBorderColor: '#ffffff',
    rodColor: '#8a8f99',
    bobColor: '#ff5e5e',
    refLine: true,                  // dashed vertical line through the rest position
    refLineColor: 'rgba(255, 255, 255, 0.3)',
    arrow: false,                   // the measurement arrow (showArrow() turns it on later)
    arrowColor: '#ffffff',
    arrowWidth: 4,
    arrowY: null,                   // px from the top; null = just below the bob
    label: '*x*',                   // text in front of the value; *...* is italic
    labelColor: '#ffffff',
    fontSize: 30,
    decimals: 1,
    units: '',                      // e.g. ' m'
    fadeDuration: 0.5,
    ...options,
  };
  const known = new Set(Object.keys(opts));
  for (const key of Object.keys(options)) {
    if (!known.has(key)) console.warn(`createPendulum: unknown option "${key}"`);
  }

  container.style.width = opts.width + 'px';
  container.style.height = opts.height + 'px';
  const canvas = document.createElement('canvas');
  canvas.style.width = opts.width + 'px';
  canvas.style.height = opts.height + 'px';
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const fontFamily = getComputedStyle(container).fontFamily || 'sans-serif';

  let ratio = 1;
  function resize() {
    ratio = pixelRatio(opts.renderScale, opts.width, opts.height);
    canvas.width = Math.round(opts.width * ratio);
    canvas.height = Math.round(opts.height * ratio);
  }

  let swingTime = 0;                // seconds since release
  let lift = opts.raised ? 1 : 0;   // 0 = hanging straight down, 1 = at the starting angle
  const ease = p => p * p * (3 - 2 * p);
  let arrowAlpha = opts.arrow ? 1 : 0;

  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

    const amp = opts.angle * Math.PI / 180;
    const theta = opts.swinging ? amp * Math.cos(2 * Math.PI * swingTime / opts.period) : amp * ease(lift);
    const px = opts.width / 2, py = opts.pivotY;
    const bx = px + opts.length * Math.sin(theta);
    const by = py + opts.length * Math.cos(theta);

    if (opts.refLine) {
      ctx.strokeStyle = opts.refLineColor;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px, py + opts.length + opts.bobSize);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Rod, bob, pivot
    ctx.strokeStyle = opts.rodColor;
    ctx.lineWidth = opts.rodWidth;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(bx, by);
    ctx.stroke();

    ctx.fillStyle = opts.bobColor;                 // flat, no highlight or glow
    ctx.beginPath();
    ctx.arc(bx, by, opts.bobSize / 2, 0, 2 * Math.PI);
    ctx.fill();

    ctx.fillStyle = opts.pivotColor;
    ctx.strokeStyle = opts.pivotBorderColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, py, opts.pivotSize / 2, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();

    // Measurement arrow: from the rest position to below the bob, with the value x = -1 ... 1
    if (arrowAlpha > 0.001) {
      const ay = opts.arrowY ?? (py + opts.length + opts.bobSize + 20);
      const dx = bx - px;
      const head = opts.arrowWidth * 4;
      ctx.globalAlpha = arrowAlpha;
      ctx.strokeStyle = ctx.fillStyle = opts.arrowColor;
      ctx.lineWidth = opts.arrowWidth;
      ctx.lineCap = 'butt';
      if (Math.abs(dx) > head) {
        const dir = Math.sign(dx);
        ctx.beginPath();
        ctx.moveTo(px, ay);
        ctx.lineTo(bx - dir * head, ay);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(bx, ay);
        ctx.lineTo(bx - dir * head, ay - head * 0.55);
        ctx.lineTo(bx - dir * head, ay + head * 0.55);
        ctx.closePath();
        ctx.fill();
      }
      const value = Math.sin(theta) / Math.sin(amp || 1);
      const text = `${opts.label} = ${value.toFixed(opts.decimals).replace('-', '−')}${opts.units}`;
      drawText(text, px, ay + opts.fontSize * 1.1);
      ctx.globalAlpha = 1;
    }
  }

  // "*x* = 0.4": italic between the stars
  function drawText(text, x, y) {
    const parts = replaceSymbols(text).split('*');
    const fontFor = i => `${i % 2 ? 'italic ' : ''}${opts.fontSize}px ${fontFamily}`;
    let total = 0;
    parts.forEach((p, i) => { ctx.font = fontFor(i); total += ctx.measureText(p).width; });
    let cx = x - total / 2;
    ctx.fillStyle = opts.labelColor;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    parts.forEach((p, i) => { ctx.font = fontFor(i); ctx.fillText(p, cx, y); cx += ctx.measureText(p).width; });
  }

  // ---------- animation ----------
  let frameId = null;
  let last = performance.now();
  let dirty = true;

  function animate() {
    frameId = requestAnimationFrame(animate);
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    let moving = false;
    if (opts.swinging) { swingTime += dt; moving = true; }
    const liftTarget = opts.raised ? 1 : 0;
    if (lift !== liftTarget) {
      const step = dt / Math.max(0.01, opts.raiseDuration);
      lift = liftTarget > lift ? Math.min(1, lift + step) : Math.max(0, lift - step);
      moving = true;
    }
    const target = opts.arrow ? 1 : 0;
    if (arrowAlpha !== target) {
      const step = dt / Math.max(0.01, opts.fadeDuration);
      arrowAlpha = target > arrowAlpha ? Math.min(1, arrowAlpha + step) : Math.max(0, arrowAlpha - step);
      moving = true;
    }
    if (moving || dirty) { draw(); dirty = false; }
  }

  function start() {
    if (frameId !== null) return;
    last = performance.now();
    dirty = true;
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
    release() { if (!opts.swinging) { opts.swinging = true; swingTime = 0; } },   // let go of the bob
    hold() { opts.swinging = false; swingTime = 0; dirty = true; },               // back to the start angle
    raise(on = true, snap = false) {                                              // lift it to the start angle (or lower it)
      opts.raised = on;
      if (snap) lift = on ? 1 : 0;
      dirty = true;
    },
    showArrow(on = true, snap = false) {
      opts.arrow = on;
      if (snap) arrowAlpha = on ? 1 : 0;
      dirty = true;
    },
    get swinging() { return opts.swinging; },
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
