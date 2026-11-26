// plugins/textPlugin.js
//
// A block of text you can put anywhere on a slide, without moving anything else:
//
//   <div class="text" data-x="0.25" data-y="0.15">
//       <h2>Stars sing</h2>
//       <p>and we can listen</p>
//   </div>
//
// Inside it, write ordinary reveal.js content: h1 ... h6, p, ul, em, fragments, ... (sizes and fonts
// come from the theme as usual). The block's centre goes to data-x, data-y (fractions of the slide,
// 0..1, from the left / top). It leaves the slide's layout, so it neither pushes nor is pushed by
// the other objects. Full list: docs/text.md
//
//   data-anchor="top-left"   that corner (or side) goes to x, y instead of the centre
//   data-width="500"         wrap the text at this width (px); otherwise it is as wide as its longest line
//   data-align="left"        text alignment inside the block (default: center)
//
// A word that comes apart on a press, with a note under each part:
//
//   <div class="text word-split" data-split-step>
//       <h1><span data-note="stars">astero</span><span data-note="vibrations">seismo</span><span data-note="study of">logy</span></h1>
//   </div>
//
// It starts as one word; on the press, dots open up between the parts and the notes fade in below.
// It grows from its centre (the block is as wide as the slide unless data-width is given).
import { placeOnSlide, triggerFor, isShown, formatLabel } from './lib/revealHelpers.js';

const ALIGN = ['left', 'center', 'right', 'justify'];
const splits = [];                                   // { el, step } of the words that split

// Each [data-note] part gets its note (below it) and a dot before it (except the first);
// both stay hidden until the block gets the class "split" (styled in astro.scss)
function makeWordSplit(el, deck, fullWidth) {
  const parts = [...el.querySelectorAll('[data-note]')];
  if (!parts.length) console.warn('word-split: mark the parts with <span data-note="...">', el);
  parts.forEach((part, i) => {
    part.classList.add('word-part');
    const note = document.createElement('span');
    note.className = 'word-note';
    note.innerHTML = formatLabel(part.dataset.note);
    part.appendChild(note);
    if (i > 0) {
      const dot = document.createElement('span');
      dot.className = 'word-dot';
      dot.textContent = '·';
      part.before(dot);
    }
  });
  // as wide as the slide, centred: then the word grows from its centre when it comes apart
  if (fullWidth) el.style.width = `${deck.getConfig().width}px`;
  splits.push({ el, step: triggerFor(el, 'splitStep') });
}

export const TextPlugin = {
  id: 'text',

  init(deck) {
    for (const el of deck.getRevealElement().querySelectorAll('.slides .text')) {
      const { width, align } = el.dataset;
      if (width !== undefined) {
        if (Number(width) > 0) el.style.width = `${Number(width)}px`;
        else console.warn(`text: data-width="${width}" should be a width in px`, el);
      }
      if (align !== undefined) {
        if (ALIGN.includes(align)) el.style.textAlign = align;
        else console.warn(`text: data-align="${align}" (use ${ALIGN.join(', ')})`, el);
      }
      if (el.classList.contains('word-split')) makeWordSplit(el, deck, width === undefined);
      if (!('x' in el.dataset) && !('y' in el.dataset)) el.dataset.x = el.dataset.y = '0.5';   // centre of the slide
      placeOnSlide(el, deck);
    }

    // words that split on a press
    const update = () => {
      for (const { el, step } of splits) el.classList.toggle('split', isShown(step));
    };
    for (const event of ['ready', 'slidechanged', 'fragmentshown', 'fragmenthidden']) deck.on(event, update);
  },
};
