// plugins/guitarPlugin.js
//
// Turns every <div class="guitar" data-...> into a guitar (see guitar.js).
// Full attribute list: docs/guitar.md
//
//   data-strings="false"          a guitar without strings
//   data-wiggle="breathe, bend"   which toy body modes it wiggles in (see WIGGLE_MODES in guitar.js)
//   data-wiggle-step              it starts wiggling on the next press (otherwise: as soon as the slide shows,
//                                 if data-wiggle is given)
//   data-wiggle-stop-step         ... and calms down on a later press
//   data-strum-step               all six strings are strummed on a press
import { createGuitar } from './guitar.js';
import { bool, stringList, readOptions, triggerFor, isShown, manageSlideItems, reserveSize }
  from './lib/revealHelpers.js';

const ATTRIBUTES = {
  width:          ['width',          Number],
  height:         ['height',         Number],
  bodyColor:      ['bodyColor',      String],
  edgeColor:      ['edgeColor',      String],
  neckColor:      ['neckColor',      String],
  headColor:      ['headColor',      String],
  holeColor:      ['holeColor',      String],
  stringColor:    ['stringColor',    String],
  holdColor:      ['holdColor',      String],
  strings:        ['strings',        bool],
  slowdown:       ['slowdown',       Number],
  maxDisplayHz:   ['maxDisplayHz',   Number],
  decayTime:      ['decayTime',      Number],
  decaySlope:     ['decaySlope',     Number],
  stiffness:      ['stiffness',      Number],
  pluckHeight:    ['pluckHeight',    Number],
  maxPull:        ['maxPull',        Number],
  interactive:    ['interactive',    bool],
  wiggle:         ['wiggle',         stringList],
  wiggleAmount:   ['wiggleAmount',   Number],
  wiggleSpeed:    ['wiggleSpeed',    Number],
  wiggleRamp:     ['wiggleRamp',     Number],
  wigglePatches:  ['wigglePatches',  bool],
  wiggleColors:   ['wiggleColors',   stringList],
  wiggleOpacity:  ['wiggleOpacity',  Number],
};

export const GuitarPlugin = {
  id: 'guitar',

  init(deck) {
    const steps = new Map();                         // element -> { wiggle, stop, strum }
    for (const el of deck.getRevealElement().querySelectorAll('.guitar')) {
      const o = readOptions(el, ATTRIBUTES);
      reserveSize(el, o.width ?? 800, o.height ?? 373);
      const wiggle = triggerFor(el, 'wiggleStep');
      const stop = triggerFor(el, 'wiggleStopStep', wiggle ?? el);
      const strum = triggerFor(el, 'strumStep', stop ?? wiggle ?? el);
      steps.set(el, { wiggle, stop, strum, auto: 'wiggle' in el.dataset && !wiggle });
    }
    const owner = new Map();
    for (const [el, s] of steps) for (const t of [s.wiggle, s.stop, s.strum]) if (t) owner.set(t, el);

    // Wiggling right now? Only from which steps are shown, so back / jumps land right.
    function wantWiggle(el) {
      const s = steps.get(el);
      const started = s.wiggle ? isShown(s.wiggle) : s.auto;
      return started && !isShown(s.stop);
    }

    const items = manageSlideItems(deck, '.guitar', {
      create: item => createGuitar(item.el, {
        ...readOptions(item.el, ATTRIBUTES),
        renderScale: deck.getScale(),
      }),
      onShow: item => item.handle.snapWiggle(wantWiggle(item.el)),
      onPrint: item => item.handle.snapWiggle(false),
    });

    function onFragments(e) {
      for (const f of e.fragments) {
        const el = owner.get(f);
        const item = el && items.find(i => i.el === el);
        if (!item?.handle || !item.shown) continue;
        const want = wantWiggle(el);
        if (want && !item.handle.wiggling) item.handle.wiggle();
        if (!want && item.handle.wiggling) item.handle.stopWiggle();
        if (f === steps.get(el).strum && e.type === 'fragmentshown') item.handle.strum();
      }
    }
    deck.on('fragmentshown', onFragments);
    deck.on('fragmenthidden', onFragments);
  },
};
