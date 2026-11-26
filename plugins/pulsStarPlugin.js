// plugins/pulsStarPlugin.js
//
// Turns every <div class="star" data-l="..." data-m="..."> into a pulsating star showing one
// spherical harmonic (see sphericalHarmonics.js). Full attribute list: docs/pulsating-star.md
//
// Size: data-radius="100" = the star's radius (at rest) in slide pixels; that is the only size there is.
// Its box on the slide is the star plus just enough room for the pulsation (and the label below).
import { createStar, fillFor } from './sphericalHarmonics.js';
import { bool, readOptions, manageSlideItems, starBox, placeOnSlide, formatLabel, triggerFor, isShown }
  from './lib/revealHelpers.js';

// data-attribute (camelCased) -> [createStar option, converter]
const ATTRIBUTES = {
  l:           ['l',              Number],
  m:           ['m',              Number],
  segments:    ['segments',       v => (v === 'auto' ? v : Number(v))],
  rate:        ['pulseRate',      Number],
  amp:         ['pulseAmplitude', Number],
  spin:        ['spinRate',       Number],
  // the same three under their long names (as in createStar), so either spelling works
  pulseRate:      ['pulseRate',      Number],
  pulseAmplitude: ['pulseAmplitude', Number],
  spinRate:       ['spinRate',       Number],
  colors:      ['colors',         v => v.split(',').map(s => s.trim())],
  colorGamma:  ['colorGamma',     Number],
  colorMode:   ['colorMode',      String],
  grid:        ['grid',           bool],
  gridSpacing: ['gridSpacing',    Number],
  gridColor:   ['gridColor',      String],
  gridWidth:   ['gridWidth',      Number],
  gridOpacity: ['gridOpacity',    Number],
  rampTime:    ['rampTime',       Number],       // seconds to start pulsing / come to rest (with data-pulse-step)
  radius:      ['radius',         Number],       // the star's radius in slide px (the only size)
  // cut open (a wedge facing the viewer), with acoustic rays inside
  cut:         ['cut',            bool],
  cutOpen:     ['cutOpen',        bool],
  cutAngle:    ['cutAngle',       Number],
  cutDuration: ['cutDuration',    Number],
  cutColor:    ['cutColor',       String],
  rays:        ['rays',           v => (v.trim() === 'none' ? [] : v.split(',').map(Number))],
  rayOmega:    ['rayOmega',       Number],
  rayFrequencies: ['rayFrequencies', v => v.split(',').map(Number)],
  rayTrail:    ['rayTrail',       Number],
  raySpeed:    ['raySpeed',       Number],
  rayColors:   ['rayColors',      v => v.split(',').map(s => s.trim())],
  rayWidth:    ['rayWidth',       Number],
};

// ---------- Size ----------

// data-radius (px) -> a square canvas that holds the star swelling to 1 + amplitude
const DEFAULT_RADIUS = 100;
function optionsOf(el) {
  const { radius = DEFAULT_RADIUS, ...o } = readOptions(el, ATTRIBUTES);
  o.fill = fillFor(o.pulseAmplitude ?? 0.1);
  o.width = o.height = Math.round(2 * radius / o.fill);
  return o;
}

// A misspelled attribute would otherwise just be ignored without a word
const OTHER_ATTRIBUTES = ['label', 'labelColor', 'labelOffset', 'x', 'y', 'anchor', 'pulseStep', 'cutStep', 'cutCloseStep',
  'moveStep', 'moveX', 'moveY', 'moveScale', 'moveDuration'];
function warnUnknown(el) {
  for (const key of Object.keys(el.dataset)) {
    if (key in ATTRIBUTES || OTHER_ATTRIBUTES.includes(key)) continue;
    const name = 'data-' + key.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
    const hint = ['size', 'width', 'height'].includes(key) ? ': data-radius (px) sets the size now' : ' (see docs/pulsating-star.md)';
    console.warn(`star: unknown attribute ${name}${hint}`, el);
  }
}

// ---------- Caption ----------

const AUTO_LABEL = '*\\ell* = {l}, *m* = {m}';      // renders as: ℓ = 15, m = 11 (variables in italics)

// Optional caption below the star.
//   data-label                 -> auto label
//   data-label="text"          -> your text: {l} {m} are replaced, \ell etc. become symbols, *x* is italic
//   data-label-color="gold"    -> text color (any CSS color)
//   data-label-offset="4"      -> gap in px between the canvas and the label (negative = closer)
function makeCaption(el, options) {
  if (!('label' in el.dataset)) return;
  const l = options.l ?? 2;                         // same defaults as createStar
  const m = options.m ?? 1;

  const raw = el.dataset.label.trim();
  const template = (raw === '' || raw === 'auto') ? AUTO_LABEL : raw;
  const caption = document.createElement('div');
  caption.className = 'star-caption';
  caption.innerHTML = formatLabel(template.replaceAll('{l}', String(l)).replaceAll('{m}', String(m)));

  if ('labelColor' in el.dataset) caption.style.color = el.dataset.labelColor;
  const offset = Number(el.dataset.labelOffset);
  const gap = 'labelOffset' in el.dataset && Number.isFinite(offset) ? offset : 4;
  caption.style.top = `${options.height + gap}px`;                  // just below the canvas

  el.appendChild(caption);
}

// ---------- The plugin ----------

export const StarPlugin = {
  id: 'star',

  init(deck) {
    // data-pulse-step: at rest (a plain round sphere) until the next press, then it starts pulsing
    const pulseSteps = new Map();                    // element -> its step trigger
    // data-cut-step: opens on that press; data-cut-close-step: closes again
    const cutSteps = new Map();                      // element -> { open, close }
    for (const el of deck.getRevealElement().querySelectorAll('.star')) {
      warnUnknown(el);
      const options = optionsOf(el);
      starBox(el, options.width, deck, 'label' in el.dataset);
      makeCaption(el, options);
      placeOnSlide(el, deck);                        // data-x / data-y
      const step = triggerFor(el, 'pulseStep');
      if (step) pulseSteps.set(el, step);
      const open = triggerFor(el, 'cutStep', step ?? el);
      const close = triggerFor(el, 'cutCloseStep', open ?? step ?? el);
      if (open || close) cutSteps.set(el, { open, close });
    }
    // should it be open now? (null: no steps, it keeps its starting state)
    const wantOpen = el => {
      const c = cutSteps.get(el);
      if (!c) return null;
      return (c.open ? isShown(c.open) : !!optionsOf(el).cutOpen) && !isShown(c.close);
    };

    const items = manageSlideItems(deck, '.star', {
      create: item => createStar(item.el, {
        ...optionsOf(item.el),
        still: pulseSteps.has(item.el),
        renderScale: deck.getScale(),
      }),
      // arriving at the slide: at rest, or already pulsing if its step was passed (coming back)
      onShow: item => {
        const step = pulseSteps.get(item.el);
        if (step) item.handle.setPulsing(isShown(step), true);
        const open = wantOpen(item.el);
        if (open !== null) item.handle.snapCut(open);
      },
      onPrint: item => {
        if (pulseSteps.has(item.el)) item.handle.setPulsing(true, true);
        if (cutSteps.get(item.el)?.open) item.handle.snapCut(true);
      },
    });

    // its step shown: start pulsing; "back": come to rest again
    const owners = new Map([...pulseSteps].map(([el, step]) => [step, el]));
    const cutOwners = new Map([...cutSteps].flatMap(([el, c]) => [c.open, c.close].filter(Boolean).map(t => [t, el])));
    function onFragments(e) {
      for (const f of e.fragments) {
        const el = owners.get(f);
        const item = el && items.find(i => i.el === el);
        if (item?.shown && item.handle) item.handle.setPulsing(isShown(f));
        const cutEl = cutOwners.get(f);
        const cutItem = cutEl && items.find(i => i.el === cutEl);
        if (cutItem?.shown && cutItem.handle) {
          if (wantOpen(cutEl)) cutItem.handle.openCut(); else cutItem.handle.closeCut();
        }
      }
    }
    deck.on('fragmentshown', onFragments);
    deck.on('fragmenthidden', onFragments);
  },
};
