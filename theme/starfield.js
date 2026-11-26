// theme/starfield.js
//
// 3D starfield behind the slides, as a reveal.js plugin:
//   - horizontal slide change (left / right): the camera turns about the vertical axis
//   - vertical slide change (up / down): the camera flies forward / backward
//   - smooth camera motion, stars wrap around periodically, spectral colors and sizes
//
// Usage: plugins: [ StarfieldPlugin, ... ]   (all numbers to tweak are in SETTINGS)

const SETTINGS = {
  totalStars: 500,
  sphereRadius: 1000,          // stars fill a box of +-sphereRadius around the camera
  forwardStep: 300,            // how far one vertical slide flies the camera
  rotationStep: Math.PI / 6,   // how far one horizontal slide turns the camera (radians)
  smoothingTime: 0.325,        // seconds; bigger = slower, softer camera motion
  focalLength: 600,
  maxPixelRatio: 2,            // render resolution cap (the field is soft anyway)
  glowBlur: 14,                // glow around the brightest stars
};

// Stellar color profiles by spectral class, with how common each one is
const STELLAR_COLORS = [
  { rgb: '130, 180, 255', weight: 0.18 },
  { rgb: '200, 225, 255', weight: 0.27 },
  { rgb: '255, 255, 255', weight: 0.25 },
  { rgb: '255, 210, 120', weight: 0.20 },
  { rgb: '255, 140, 110', weight: 0.10 },
];

function randomColor() {
  let r = Math.random();
  for (const c of STELLAR_COLORS) {
    if ((r -= c.weight) <= 0) return c.rgb;
  }
  return '255, 255, 255';
}

function generateStars(count, R) {
  return Array.from({ length: count }, () => {
    const roll = Math.random();
    const baseRadius = roll < 0.6 ? 0.8 + Math.random() * 0.9      // many faint stars
                     : roll < 0.9 ? 1.8 + Math.random() * 1.8      // some medium
                     :              4.0 + Math.random() * 3.0;     // a few bright ones
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = R * Math.cbrt(Math.random());                         // uniform in the volume
    return {
      x: r * Math.sin(phi) * Math.cos(theta),
      y: r * Math.sin(phi) * Math.sin(theta),
      z: r * Math.cos(phi),
      baseRadius,
      alpha: 0.3 + Math.random() * 0.6,
      color: randomColor(),
      isBright: baseRadius > 2.5,
    };
  });
}

// Wrap a coordinate into [-R, R)
function wrap(value, R) {
  const d = 2 * R;
  return (((value + R) % d) + d) % d - R;
}

const StarfieldPlugin = {
  id: 'starfield',

  init(deck) {
    const S = SETTINGS;
    const reveal = deck.getRevealElement();

    const canvas = document.createElement('canvas');
    canvas.className = 'starfield';                 // styled in astro.scss
    reveal.insertBefore(canvas, reveal.firstChild);
    const ctx = canvas.getContext('2d');
    const stars = generateStars(S.totalStars, S.sphereRadius);

    // Camera: position (x, z) and heading angle; "target" is where it is heading
    const cam = { x: 0, z: 0, angle: 0 };
    const target = { x: 0, z: 0, angle: 0 };

    deck.on('ready', e => {
      cam.angle = target.angle = e.indexh * S.rotationStep;
    });

    deck.on('slidechanged', e => {
      if (!e.currentSlide || !e.previousSlide) return;
      const now = deck.getIndices(e.currentSlide);
      const before = deck.getIndices(e.previousSlide);

      if (now.h !== before.h) {                     // left / right: turn, back to the centre
        target.angle = now.h * S.rotationStep;
        target.x = target.z = 0;
      } else if (now.v !== before.v) {              // up / down: fly along the viewing direction
        const travel = (now.v - before.v) * S.forwardStep;
        target.x += travel * Math.sin(target.angle);
        target.z += travel * Math.cos(target.angle);
      }
    });

    let last = null;
    function render(time) {
      requestAnimationFrame(render);
      const dt = last === null ? 0 : Math.min((time - last) / 1000, 0.1);
      last = time;

      const k = 1 - Math.exp(-dt / S.smoothingTime);
      cam.x += (target.x - cam.x) * k;
      cam.z += (target.z - cam.z) * k;
      cam.angle += (target.angle - cam.angle) * k;

      const width = reveal.clientWidth || window.innerWidth;
      const height = reveal.clientHeight || window.innerHeight;
      if (!width || !height) return;

      const dpr = Math.min(window.devicePixelRatio || 1, S.maxPixelRatio);
      const w = Math.round(width * dpr), h = Math.round(height * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const cx = width / 2, cy = height / 2;
      const cos = Math.cos(cam.angle), sin = Math.sin(cam.angle);
      const R = S.sphereRadius;

      for (const star of stars) {
        // Camera-relative coordinates, rotated into the camera frame, wrapped periodically
        const dx = star.x - cam.x, dz = star.z - cam.z;
        const x = wrap(dx * cos - dz * sin, R);
        const y = wrap(star.y, R);
        const z = wrap(dx * sin + dz * cos, R);
        if (z <= 10) continue;                      // behind the camera

        const scale = S.focalLength / z;
        const sx = cx + x * scale, sy = cy + y * scale;
        if (sx < -120 || sx > width + 120 || sy < -120 || sy > height + 120) continue;

        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(0.6, star.baseRadius * scale), 0, Math.PI * 2);
        if (star.isBright && scale > 0.2) {
          ctx.shadowBlur = S.glowBlur * scale;
          ctx.shadowColor = `rgba(${star.color}, 0.85)`;
        }
        ctx.fillStyle = `rgba(${star.color}, ${Math.min(1, Math.max(0.2, star.alpha * scale))})`;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
    requestAnimationFrame(render);
  },
};

window.StarfieldPlugin = StarfieldPlugin;
