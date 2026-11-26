// plugins/stringPlugin.js
//
// Turns every <div class="string" data-...> into a standing wave on a string between two posts
// (see string.js):
//
//   <div class="string" data-mode="2" data-rate="1" data-width="360" data-height="120"></div>
//
//   data-mode    1 = the fundamental, 2 = the first overtone (one node in the middle), ...
//   data-rate    oscillations per second
//   data-x, -y   free placement on the slide (fractions, like the stars)
//
// It moves as soon as its slide shows (and keeps moving while it fades in as a fragment).
// Full attribute list: docs/string.md
import { createString } from './string.js';
import { bool, readOptions, manageSlideItems, reserveSize, placeOnSlide } from './lib/revealHelpers.js';

const ATTRIBUTES = {
  width:         ['width',         Number],
  height:        ['height',        Number],
  mode:          ['mode',          Number],
  rate:          ['rate',          Number],
  amplitude:     ['amplitude',     Number],
  color:         ['color',         String],
  lineWidth:     ['lineWidth',     Number],
  postColor:     ['postColor',     String],
  postWidth:     ['postWidth',     Number],
  postHeight:    ['postHeight',    Number],
  envelope:      ['envelope',      bool],
  envelopeColor: ['envelopeColor', String],
  nodes:         ['nodes',         bool],
  nodeColor:     ['nodeColor',     String],
  label:         ['label',         String],
  labelColor:    ['labelColor',    String],
  fontSize:      ['fontSize',      Number],
};

export const StringPlugin = {
  id: 'string',

  init(deck) {
    for (const el of deck.getRevealElement().querySelectorAll('.string')) {
      const o = readOptions(el, ATTRIBUTES);
      reserveSize(el, o.width ?? 360, o.height ?? 120, deck);
      placeOnSlide(el, deck);                        // data-x / data-y
    }
    manageSlideItems(deck, '.string', {
      maxLive: 24,                                   // plain 2D canvases: cheap
      create: item => createString(item.el, {
        ...readOptions(item.el, ATTRIBUTES),
        renderScale: deck.getScale(),
      }),
      onShow: item => item.handle.reset(),
    });
  },
};
