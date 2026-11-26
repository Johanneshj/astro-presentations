// plugins/pendulumPlugin.js
//
// Turns every <div class="pendulum" data-...> into a pendulum (see pendulum.js).
// Full attribute list: docs/pendulum.md
//
//   data-swing-step     held at its starting angle; let go on the next press
//                       (without it, the pendulum swings as soon as the slide shows)
//   data-arrow-step     the measurement arrow appears on a press (data-arrow: always shown)
import { createPendulum } from './pendulum.js';
import { bool, readOptions, triggerFor, isShown, manageSlideItems, reserveSize } from './lib/revealHelpers.js';

const ATTRIBUTES = {
  width:            ['width',            Number],
  height:           ['height',           Number],
  length:           ['length',           Number],
  angle:            ['angle',            Number],
  period:           ['period',           Number],
  pivotY:           ['pivotY',           Number],
  pivotSize:        ['pivotSize',        Number],
  rodWidth:         ['rodWidth',         Number],
  bobSize:          ['bobSize',          Number],
  pivotColor:       ['pivotColor',       String],
  pivotBorderColor: ['pivotBorderColor', String],
  rodColor:         ['rodColor',         String],
  bobColor:         ['bobColor',         String],
  refLine:          ['refLine',          bool],
  refLineColor:     ['refLineColor',     String],
  arrow:            ['arrow',            bool],
  arrowColor:       ['arrowColor',       String],
  arrowWidth:       ['arrowWidth',       Number],
  arrowY:           ['arrowY',           Number],
  label:            ['label',            String],
  labelColor:       ['labelColor',       String],
  fontSize:         ['fontSize',         Number],
  decimals:         ['decimals',         Number],
  units:            ['units',            String],
};

export const PendulumPlugin = {
  id: 'pendulum',

  init(deck) {
    const steps = new Map();
    for (const el of deck.getRevealElement().querySelectorAll('.pendulum')) {
      const o = readOptions(el, ATTRIBUTES);
      reserveSize(el, o.width ?? 900, o.height ?? 520);
      const swing = triggerFor(el, 'swingStep');
      const arrow = triggerFor(el, 'arrowStep', swing ?? el);
      steps.set(el, { swing, arrow, arrowAlways: !!o.arrow });
    }
    const owner = new Map();
    for (const [el, s] of steps) for (const t of [s.swing, s.arrow]) if (t) owner.set(t, el);

    const wantSwing = el => { const s = steps.get(el); return s.swing ? isShown(s.swing) : true; };
    const wantArrow = el => { const s = steps.get(el); return s.arrow ? isShown(s.arrow) : s.arrowAlways; };

    const items = manageSlideItems(deck, '.pendulum', {
      create: item => createPendulum(item.el, {
        ...readOptions(item.el, ATTRIBUTES),
        swinging: false,
        renderScale: deck.getScale(),
      }),
      onShow: item => {
        item.handle.hold();
        if (wantSwing(item.el)) item.handle.release();
        item.handle.showArrow(wantArrow(item.el), true);
      },
    });

    function onFragments(e) {
      for (const f of e.fragments) {
        const el = owner.get(f);
        const item = el && items.find(i => i.el === el);
        if (!item?.handle || !item.shown) continue;
        if (wantSwing(el)) item.handle.release(); else item.handle.hold();
        item.handle.showArrow(wantArrow(el));
      }
    }
    deck.on('fragmentshown', onFragments);
    deck.on('fragmenthidden', onFragments);
  },
};
