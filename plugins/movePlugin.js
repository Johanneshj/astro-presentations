// plugins/movePlugin.js
//
// Move anything placed with data-x / data-y (stars, text blocks, props, ...) to a new place on a press:
//
//   <div class="stellar" data-x="0.25" data-y="0.3"
//        data-move-step="2" data-move-x="0.1" data-move-y="0.25" data-move-scale="0.6"></div>
//
//   data-move-step        the press that moves it. Everything on a slide with the same value moves on
//                         the same press. A number places the step like data-fragment-index; without
//                         one the step comes after the slide's other steps.
//   data-move-x, -y       where it goes (fractions of the slide, like data-x / data-y; default: stays)
//   data-move-scale       its size there (1 = unchanged, 0.5 = half)
//   data-move-duration    seconds (default 1.2)
//
// "Back" moves it back again. Full list: docs/move.md
import { makeTrigger, isShown } from './lib/revealHelpers.js';

const ANCHORS = { left: 0, center: 0.5, right: 1, top: 0, bottom: 1 };

// The point of the element that sits at x, y (data-anchor; default: its centre), as fractions
function anchorOf(el) {
  let ax = 0.5, ay = 0.5;
  for (const w of (el.dataset.anchor ?? '').toLowerCase().split(/[\s-]+/).filter(Boolean)) {
    if (w === 'left' || w === 'right') ax = ANCHORS[w];
    if (w === 'top' || w === 'bottom') ay = ANCHORS[w];
  }
  return [ax, ay];
}

export const MovePlugin = {
  id: 'move',

  init(deck) {
    const movers = [];
    const triggers = new Map();                      // slide -> (step value -> trigger)
    for (const el of deck.getRevealElement().querySelectorAll('.slides [data-move-step]')) {
      const slide = el.closest('section');
      const value = el.dataset.moveStep;
      if (!triggers.has(slide)) triggers.set(slide, new Map());
      const bySlide = triggers.get(slide);
      if (!bySlide.has(value)) {                     // one step per value per slide, at the end of the slide
        const trigger = makeTrigger(value);
        slide.appendChild(trigger);
        bySlide.set(value, trigger);
      }
      const read = (name, fallback) => {
        const v = el.dataset[name];
        return v === undefined || v === '' || isNaN(v) ? fallback : Number(v);
      };
      const x = read('x', 0.5), y = read('y', 0.5);
      movers.push({
        el, slide, trigger: bySlide.get(value),
        dx: read('moveX', x) - x, dy: read('moveY', y) - y,
        scale: read('moveScale', 1),
        duration: read('moveDuration', 1.2),
      });
    }
    if (!movers.length) return;

    function apply(m, animate) {
      const { width: W, height: H } = deck.getConfig();
      const moved = isShown(m.trigger);
      const el = m.el;
      // scale about the point that sits at x, y (a star: its centre, not the middle of star + label)
      const [ax, ay] = anchorOf(el);
      const w = el.offsetWidth;
      const h = el.classList.contains('star-box') ? w : el.offsetHeight;
      el.style.transformOrigin = `${ax * w}px ${ay * h}px`;
      el.style.transition = animate
        ? `translate ${m.duration}s ease-in-out, scale ${m.duration}s ease-in-out` : 'none';
      el.style.translate = moved ? `${m.dx * W}px ${m.dy * H}px` : '';
      el.style.scale = moved && m.scale !== 1 ? String(m.scale) : '';
      // a star's name keeps its size (it shrinks back by as much as the star shrinks)
      for (const caption of el.querySelectorAll(':scope > .star-caption')) {
        // (the caption is centred by translateX(-50%), which comes after the scale: scaling about its
        // top-left corner keeps it centred under the star)
        caption.style.transformOrigin = '0 0';
        caption.style.transition = el.style.transition.replace(/translate [^,]*, /, '');
        caption.style.scale = moved && m.scale !== 1 ? String(1 / m.scale) : '';
      }
    }

    const update = animate => {
      const current = deck.getCurrentSlide();
      for (const m of movers) {
        if (animate && m.slide !== current && !m.slide.contains(current)) continue;
        apply(m, animate);
      }
    };
    deck.on('ready', () => update(false));
    deck.on('slidechanged', () => update(false));    // arriving on a slide: already in place, no gliding
    deck.on('fragmentshown', () => update(true));
    deck.on('fragmenthidden', () => update(true));
  },
};
