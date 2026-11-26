// plugins/guitarPlugin.js
//
// Turns every <div class="guitar" data-...> into a guitar (see guitar.js).
// Full attribute list: docs/guitar.md
//
//   data-wiggle="edge"            wiggles in these modes as soon as the slide shows (see WIGGLE_MODES in guitar.js)
//   child fragments set the wiggle on a press, e.g.
//     <div class="guitar">
//       <span class="fragment" data-wiggle="edge"></span>          1st press: waves around the edge
//       <span class="fragment" data-wiggle="bend, neck"></span>    2nd press: it turns and the whole guitar moves
//       <span class="fragment" data-wiggle="none"></span>          3rd press: calm down, turn back
//     </div>
//   The last shown step wins, so "back" undoes a step.
import { createGuitar } from './guitar.js';
import { stringList, readOptions, isShown, manageSlideItems, reserveSize, placeOnSlide } from './lib/revealHelpers.js';

const ATTRIBUTES = {
  width:          ['width',          Number],
  height:         ['height',         Number],
  bodyColor:      ['bodyColor',      String],
  edgeColor:      ['edgeColor',      String],
  neckColor:      ['neckColor',      String],
  headColor:      ['headColor',      String],
  holeColor:      ['holeColor',      String],
  fretColor:      ['fretColor',      String],
  nutColor:       ['nutColor',       String],
  tilt:           ['tilt',           Number],
  wiggleTilt:     ['wiggleTilt',     Number],
  yaw:            ['yaw',            Number],
  angle:          ['angle',          Number],
  turnTime:       ['turnTime',       Number],
  wiggle:         ['wiggle',         stringList],
  wiggleAmount:   ['wiggleAmount',   Number],
  wiggleSpeed:    ['wiggleSpeed',    Number],
  wiggleRamp:     ['wiggleRamp',     Number],
};

const stepsOf = el => [...el.querySelectorAll(':scope > [data-wiggle]')];

export const GuitarPlugin = {
  id: 'guitar',

  init(deck) {
    const owner = new Map();                         // step element -> its guitar
    for (const el of deck.getRevealElement().querySelectorAll('.guitar')) {
      const o = readOptions(el, ATTRIBUTES);
      reserveSize(el, o.width ?? 800, o.height ?? 373, deck);
      placeOnSlide(el, deck);                        // data-x / data-y
      for (const step of stepsOf(el)) {
        step.style.display = 'none';                 // a step is only a marker for reveal
        owner.set(step, el);
      }
    }

    // The modes wanted right now: those of the shown step with the highest fragment index,
    // else the guitar's own data-wiggle. Only from what is shown, so back / jumps land right.
    function wantedModes(el) {
      let modes = el.dataset.wiggle ?? '';
      let best = -Infinity;
      for (const step of stepsOf(el)) {
        const isStep = step.classList.contains('fragment');
        if (isStep && !isShown(step)) continue;
        const index = isStep ? Number(step.dataset.fragmentIndex ?? 0) : -1;
        if (index >= best) { best = index; modes = step.dataset.wiggle; }
      }
      return modes;
    }

    const items = manageSlideItems(deck, '.guitar', {
      create: item => createGuitar(item.el, {
        ...readOptions(item.el, ATTRIBUTES),
        renderScale: deck.getScale(),
      }),
      onShow: item => item.handle.setWiggle(wantedModes(item.el), true),
      onPrint: item => item.handle.setWiggle('none', true),
    });

    function onFragments(e) {
      for (const f of e.fragments) {
        const el = owner.get(f);
        const item = el && items.find(i => i.el === el);
        if (item?.handle && item.shown) item.handle.setWiggle(wantedModes(el));
      }
    }
    deck.on('fragmentshown', onFragments);
    deck.on('fragmenthidden', onFragments);
  },
};
