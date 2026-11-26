// plugins/stellarPlugin.js
//
// Turns every <div class="stellar" data-...> into a createStellar star (see stellar.js).
// Full attribute list: docs/stellar.md
//
// Opening the cut while presenting. Everything is driven by reveal's "next" (space, right arrow,
// Page Down, a presenter clicker), so it runs in order with your other fragments, and "back"
// (left arrow) undoes it step by step:
//
//   <section data-stellar-open>                     next press opens every cut star on the slide
//   <section data-stellar-open data-stellar-close>  ... and the press after that closes them again
//   <div class="stellar" data-cut data-cut-step>    this star opens on its own press
//   ... data-cut-close-step                         ... and closes on a later press of its own
//
// Without a number, a step comes in document order (where the star, or the end of the slide,
// is). With a number, e.g. data-cut-step="2", it is placed like data-fragment-index="2".
// data-cut-click additionally lets a mouse click on that star open / close it (off by default,
// so a stray click while presenting does nothing).
import { createStellar } from './stellar.js';
import { bool, readOptions, makeTrigger, triggerFor, isShown, manageSlideItems, reserveSize }
  from './lib/revealHelpers.js';

// data-attribute (camelCased) -> [createStellar option, converter]
const ATTRIBUTES = {
  color:            ['color',            String],
  temperature:      ['temperature',      Number],
  radius:           ['radius',           Number],
  rotationPeriod:   ['rotationPeriod',   Number],
  tilt:             ['tilt',             Number],
  limbDarkening:    ['limbDarkening',    Number],
  glow:             ['glow',             Number],
  glowSize:         ['glowSize',         Number],
  glowRim:          ['glowRim',          Number],
  glowRays:         ['glowRays',         Number],
  grid:             ['grid',             bool],
  gridSpacing:      ['gridSpacing',      Number],
  texture:          ['texture',          String],
  granulation:      ['granulation',      Number],
  granulationScale: ['granulationScale', Number],
  granulationSpeed: ['granulationSpeed', Number],
  spots:            ['spots',            Number],
  spotSize:         ['spotSize',         Number],
  spotLatitude:     ['spotLatitude',     Number],
  spotSeed:         ['spotSeed',         Number],
  cut:              ['cut',              bool],
  cutOpen:          ['cutOpen',          bool],     // data-cut-open = already open when the slide appears
  cutAnimate:       ['cutAnimate',       bool],     // data-cut-animate="false" = snaps open instead
  cutDuration:      ['cutDuration',      Number],
  cutAngle:         ['cutAngle',         Number],
  cutDirection:     ['cutDirection',     Number],
  structure:        ['structure',        String],
  zones:            ['zones',            String],   // e.g. data-zones="radiative:0.71, convective:1"
  radiativeColor:   ['radiativeColor',   String],
  convectiveColor:  ['convectiveColor',  String],
  centreWhite:      ['centreWhite',      Number],
  arrows:           ['arrows',           bool],
  arrowColor:       ['arrowColor',       String],
  arrowOpacity:     ['arrowOpacity',     Number],
  arrowSpeed:       ['arrowSpeed',       Number],
  radiativeArrows:  ['radiativeArrows',  Number],
};

export const StellarPlugin = {
  id: 'stellar',

  init(deck) {
    // ---- each star's own steps and optional click ----
    // (Plugins run before reveal collects the fragments, so reveal picks the triggers up like any other.)
    const steps = new Map();                         // element -> { open, close }
    for (const el of deck.getRevealElement().querySelectorAll('.stellar')) {
      const { width = 500, height = 500 } = readOptions(el, ATTRIBUTES);
      reserveSize(el, width, height);
      const open = triggerFor(el, 'cutStep');        // own steps go right after the star,
      const close = triggerFor(el, 'cutCloseStep', open ?? el);   // so they follow document order
      steps.set(el, { open, close });
    }

    // ---- slide-wide steps: at the end of the slide ----
    const slideSteps = new Map();                    // slide -> { open, close }
    for (const slide of deck.getRevealElement().querySelectorAll('section[data-stellar-open]')) {
      const open = makeTrigger(slide.dataset.stellarOpen);
      slide.appendChild(open);
      let close = null;
      if (slide.hasAttribute('data-stellar-close')) {
        close = makeTrigger(slide.dataset.stellarClose);
        slide.appendChild(close);
      }
      slideSteps.set(slide, { open, close });
    }
    const allTriggers = new Set([...steps.values(), ...slideSteps.values()]
      .flatMap(s => [s.open, s.close]).filter(Boolean));

    // Should this star be open right now? Worked out only from which steps are currently shown,
    // so going forward, going back, or jumping to a slide always lands in the right state.
    // Returns null when the star has no steps at all (then it keeps its starting state / clicks).
    function wantOpen(item) {
      const own = steps.get(item.el);
      const s = slideSteps.get(item.slide);
      if (!own.open && !own.close && !s) return null;
      const opened = own.open ? isShown(own.open)
                   : s ? isShown(s.open)
                   : !!readOptions(item.el, ATTRIBUTES).cutOpen;
      const closed = isShown(own.close) || (s && isShown(s.close));
      return opened && !closed;
    }

    const items = manageSlideItems(deck, '.stellar', {
      create: item => {
        const star = createStellar(item.el, {
          ...readOptions(item.el, ATTRIBUTES),
          renderScale: deck.getScale(),
        });
        if (!item.clickBound && 'cutClick' in item.el.dataset && bool(item.el.dataset.cutClick)) {
          item.clickBound = true;
          item.el.style.cursor = 'pointer';
          item.el.addEventListener('click', () => item.handle?.toggleCut());
        }
        return star;
      },
      // On arriving at a slide: jump straight to the right state
      onShow: item => {
        const open = wantOpen(item);
        if (open === null) item.handle.resetCut();
        else item.handle.snapCut(open);
      },
      onPrint: item => item.handle.snapCut(true),    // printed stars are drawn open
    });

    // A step was shown or hidden: animate every star on the current slide towards its new state
    function onFragments(e) {
      if (!e.fragments.some(f => allTriggers.has(f))) return;
      for (const item of items) {
        if (!item.shown || !item.handle) continue;
        const open = wantOpen(item);
        if (open === true) item.handle.openCut();
        if (open === false) item.handle.closeCut();
      }
    }
    deck.on('fragmentshown', onFragments);
    deck.on('fragmenthidden', onFragments);
  },
};
