// plugins/pulsStarPlugin.js
//
// Turns every <div class="star" data-l="..." data-m="..."> into a pulsating star showing one
// spherical harmonic (see sphericalHarmonics.js). Full attribute list: docs/pulsating-star.md
import { createStar } from './sphericalHarmonics.js';
import { bool, readOptions, manageSlideItems, reserveSize, formatLabel } from './lib/revealHelpers.js';

// data-attribute (camelCased) -> [createStar option, converter]
const ATTRIBUTES = {
  l:           ['l',              Number],
  m:           ['m',              Number],
  segments:    ['segments',       v => (v === 'auto' ? v : Number(v))],
  rate:        ['pulseRate',      Number],
  amp:         ['pulseAmplitude', Number],
  spin:        ['spinRate',       Number],
  colors:      ['colors',         v => v.split(',').map(s => s.trim())],
  colorGamma:  ['colorGamma',     Number],
  colorMode:   ['colorMode',      String],
  grid:        ['grid',           bool],
  gridSpacing: ['gridSpacing',    Number],
  gridColor:   ['gridColor',      String],
  gridWidth:   ['gridWidth',      Number],
  gridOpacity: ['gridOpacity',    Number],
};

// ---------- Caption ----------

const AUTO_LABEL = '*\\ell* = {l}, *m* = {m}';      // renders as: ℓ = 15, m = 11 (variables in italics)

// Optional caption below the star.
//   data-label                 -> auto label
//   data-label="text"          -> your text: {l} {m} are replaced, \ell etc. become symbols, *x* is italic
//   data-label-color="gold"    -> text color (any CSS color)
//   data-label-offset="16"     -> distance in px from the canvas bottom (bigger = closer to the star)
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
  caption.style.bottom = ('labelOffset' in el.dataset && Number.isFinite(offset) ? offset : 16) + 'px';

  el.appendChild(caption);
}

// ---------- The plugin ----------

export const StarPlugin = {
  id: 'star',

  init(deck) {
    for (const el of deck.getRevealElement().querySelectorAll('.star')) {
      const options = readOptions(el, ATTRIBUTES);
      reserveSize(el, options.width ?? 500, options.height ?? 500);
      makeCaption(el, options);
    }

    manageSlideItems(deck, '.star', {
      create: item => createStar(item.el, {
        ...readOptions(item.el, ATTRIBUTES),
        renderScale: deck.getScale(),
      }),
    });
  },
};
