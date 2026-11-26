// plugins/stellarPlugin.js
//
// Turns every <div class="stellar" data-...> into a createStellar star (see stellar.js), and every
// <div class="stellar-quarter"> into the same star with a quarter of it cut out (a 90 degree wedge).
// The two cut faces together look like a disc in four quarters, each showing one ingredient of a
// star: zones, burning core, photon random walks, hydrostatic equilibrium.
// Both take the same attributes. Full list: docs/stellar.md
//
// Opening the cut while presenting. Everything is driven by reveal's "next" (space, right arrow,
// Page Down, a presenter clicker), so it runs in order with your other fragments, and "back"
// (left arrow) undoes it step by step:
//
//   <section data-stellar-open>                     next press opens every cut star on the slide
//   <section data-stellar-open data-stellar-close>  ... and the press after that closes them again
//   <div class="stellar" data-cut data-cut-step>    this star opens on its own press
//   ... data-cut-close-step                         ... and closes on a later press of its own
//   ... data-regions-step data-regions-next="rays"  on a press of its own the inside changes to another
//                                                   (the old one fades out, the new one in)
//   <div class="stellar-quarter" data-quarter-steps>  the quarters show their ingredients one press at a
//                                                   time, clockwise from the upper left (the first one
//                                                   also opens the cut, unless data-cut-step came before)
//
// Without a number, a step comes in document order (where the star, or the end of the slide,
// is). With a number, e.g. data-cut-step="2", it is placed like data-fragment-index="2".
// data-cut-click additionally lets a mouse click on that star open / close it (off by default,
// so a stray click while presenting does nothing).
//
// Size: data-radius="120" = the star's radius in slide pixels; that is the only size there is. The
// star's box on the slide (its canvas) is the star plus room for its whole glow, which reaches
// GLOW_REACH x data-glow-size radii above the surface: a smaller data-glow-size = a tighter box.
import { createStellar } from './stellar.js';
import { bool, readOptions, makeTrigger, triggerFor, isShown, manageSlideItems, starBox, placeOnSlide, formatLabel }
  from './lib/revealHelpers.js';

// data-attribute (camelCased) -> [createStellar option, converter]
const ATTRIBUTES = {
  color:            ['color',            String],
  temperature:      ['temperature',      Number],
  radius:           ['radius',           Number],     // the star's radius in slide px (the only size)
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
  textureStrength:  ['textureStrength',  Number],
  textureScale:     ['textureScale',     Number],
  textureSpeed:     ['textureSpeed',     Number],
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
  regions:          ['regions',          String],   // e.g. "zones, photons, burning, hydrostatic"
  coreRadius:       ['coreRadius',       Number],
  coreGlow:         ['coreGlow',         Number],
  coreGlowColor:    ['coreGlowColor',    String],
  burningSymbols:   ['burningSymbols',   Number],
  burningSize:      ['burningSize',      Number],
  burningSpeed:     ['burningSpeed',     Number],
  burningColor:     ['burningColor',     String],
  burningInk:       ['burningInk',       String],
  hydrostaticLayers:['hydrostaticLayers', Number],
  pressureColor:    ['pressureColor',    String],
  gravityColor:     ['gravityColor',     String],
  photonWalks:      ['photonWalks',      Number],
  photonSpeed:      ['photonSpeed',      Number],
  photonColor:      ['photonColor',      String],
  questionColor:    ['questionColor',    String],
  questionSize:     ['questionSize',     Number],
  rays:             ['rays',             v => v.split(',').map(Number)],   // the "rays" interior: degrees l
  rayOmega:         ['rayOmega',         Number],
  rayFrequencies:   ['rayFrequencies',   v => v.split(',').map(Number)],
  rayTrail:         ['rayTrail',         Number],
  raySpeed:         ['raySpeed',         Number],
  rayColors:        ['rayColors',        v => v.split(',').map(s => s.trim())],
  rayWidth:         ['rayWidth',         Number],
  disk:             ['disk',             bool],     // accretion disk round the equator
  diskInner:        ['diskInner',        Number],
  diskOuter:        ['diskOuter',        Number],
  diskSpeed:        ['diskSpeed',        Number],
  diskBrightness:   ['diskBrightness',   Number],
  diskColors:       ['diskColors',       String],
};

const SELECTOR = '.stellar, .stellar-quarter';

// What a <div class="stellar-quarter"> starts from; its own attributes override these
const QUARTER_DEFAULTS = {
  cut: true,
  cutAngle: 90,
  regions: 'hydrostatic, burning, opacity, transport',   // clockwise from the upper left
};

const DEFAULT_RADIUS = 120;            // px
const GLOW_REACH = 0.5;                // the glow is gone this many radii (x data-glow-size) above the surface
const MIN_ROOM = 0.15;                 // room above the surface anyway (the hydrostatic quarter's outer arrow)

// All options of one element: the quarter defaults (if it is a stellar-quarter), then its attributes.
// data-radius (px) gives the canvas: the star plus the room its glow needs. createStellar itself
// takes the radius as a fraction of half the canvas, so that is what it is handed.
function optionsOf(el) {
  const base = el.classList.contains('stellar-quarter') ? QUARTER_DEFAULTS : {};
  const o = { ...base, ...readOptions(el, ATTRIBUTES) };
  const r = o.radius ?? DEFAULT_RADIUS;
  let room = (o.glow ?? 0.6) > 0 ? Math.max(MIN_ROOM, GLOW_REACH * (o.glowSize ?? 1)) : MIN_ROOM;
  if (o.disk) room = Math.max(room, (o.diskOuter ?? 4) - 1 + 0.05);   // the box holds the whole disk
  const half = r * (1 + room);
  o.width = o.height = Math.round(2 * half);
  o.radius = r / half;
  return o;
}

function warnOldSize(el) {
  for (const key of ['size', 'width', 'height']) {
    if (key in el.dataset) console.warn(`${el.className}: data-${key} is gone; data-radius (px) sets the size`, el);
  }
  if (Number(el.dataset.radius) <= 2) console.warn(`${el.className}: data-radius is in slide pixels now (e.g. 120)`, el);
}

// Optional caption just below the star's surface (inside its glow, so it sits close to the star):
//   data-label="Red giant"     -> the text (\name becomes a symbol, *x* is italic)
//   data-label-color="gold"    -> text color (any CSS color)
//   data-label-offset="10"     -> gap in px between the surface and the label (negative = closer)
function makeCaption(el) {
  if (!('label' in el.dataset)) return;
  const o = optionsOf(el);
  const caption = document.createElement('div');
  caption.className = 'star-caption star-name';       // font: --astro-label-font in the theme
  caption.innerHTML = formatLabel(el.dataset.label);
  if ('labelColor' in el.dataset) caption.style.color = el.dataset.labelColor;
  const offset = Number(el.dataset.labelOffset);
  const gap = 'labelOffset' in el.dataset && Number.isFinite(offset) ? offset : 10;
  caption.style.top = `${(o.width / 2) * (1 + o.radius) + gap}px`;   // centre + radius, in px
  el.appendChild(caption);
}

// data-quarter-steps: one step per quarter (as many as data-regions names, at most 4), placed after `after`.
// data-quarter-steps="3" numbers them like data-fragment-index 3, 4, 5, 6.
function quarterTriggers(el, after) {
  if (!('quarterSteps' in el.dataset)) return [];
  const regions = String(optionsOf(el).regions ?? '').split(',').filter(x => x.trim());
  const n = regions.length > 1 ? Math.min(4, regions.length) : 4;
  const v = el.dataset.quarterSteps;
  const first = v === '' || isNaN(v) ? null : Number(v);
  const triggers = [];
  for (let i = 0; i < n; i++) {
    const t = makeTrigger(first === null ? undefined : first + i);
    after.after(t);
    triggers.push(after = t);
  }
  return triggers;
}

export const StellarPlugin = {
  id: 'stellar',

  init(deck) {
    // ---- each star's own steps and optional click ----
    // (Plugins run before reveal collects the fragments, so reveal picks the triggers up like any other.)
    const steps = new Map();                         // element -> { open, quarters, swap, close }
    for (const el of deck.getRevealElement().querySelectorAll(SELECTOR)) {
      warnOldSize(el);
      starBox(el, optionsOf(el).width, deck);
      makeCaption(el);
      placeOnSlide(el, deck);                        // data-x / data-y
      const open = triggerFor(el, 'cutStep');        // own steps go right after the star,
      const quarters = quarterTriggers(el, open ?? el);            // so they follow document order
      const swap = triggerFor(el, 'regionsStep', quarters.at(-1) ?? open ?? el);
      const close = triggerFor(el, 'cutCloseStep', swap ?? quarters.at(-1) ?? open ?? el);
      steps.set(el, { open, quarters, swap, close });
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
      .flatMap(s => [s.open, s.close, s.swap, ...(s.quarters ?? [])]).filter(Boolean));

    // Should this star be open right now? Worked out only from which steps are currently shown,
    // so going forward, going back, or jumping to a slide always lands in the right state.
    // Returns null when the star has no steps at all (then it keeps its starting state / clicks).
    function wantOpen(item) {
      const own = steps.get(item.el);
      const s = slideSteps.get(item.slide);
      if (!own.open && !own.close && !own.quarters.length && !s) return null;
      const opened = own.open ? isShown(own.open)
                   : s ? isShown(s.open)
                   : own.quarters.length ? false
                   : !!optionsOf(item.el).cutOpen;
      const closed = isShown(own.close) || (s && isShown(s.close));
      const quarterOpened = own.quarters.length > 0 && quartersShown(item) > 0;   // the first quarter step opens it
      return (opened || quarterOpened) && !closed;
    }

    // What the inside shows now: data-regions, or data-regions-next once its step has been shown
    function wantRegions(item) {
      const { swap } = steps.get(item.el);
      const o = optionsOf(item.el);
      return isShown(swap) && 'regionsNext' in item.el.dataset ? item.el.dataset.regionsNext : o.regions ?? 'zones';
    }

    // How many of its quarters should show their ingredients (all four without quarter steps)
    function quartersShown(item) {
      const { quarters } = steps.get(item.el);
      return quarters.length ? quarters.filter(isShown).length : 4;
    }

    const items = manageSlideItems(deck, SELECTOR, {
      create: item => {
        const star = createStellar(item.el, {
          ...optionsOf(item.el),
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
        item.handle.showQuarters(quartersShown(item), true);
        item.handle.swapRegions(wantRegions(item), true);
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
        item.handle.showQuarters(quartersShown(item));
        item.handle.swapRegions(wantRegions(item));
      }
    }
    deck.on('fragmentshown', onFragments);
    deck.on('fragmenthidden', onFragments);
  },
};
