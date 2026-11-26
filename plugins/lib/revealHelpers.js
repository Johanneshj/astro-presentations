// plugins/lib/revealHelpers.js
//
// The pieces every plugin in this folder needs, written once:
//
//   readOptions(el, ATTRIBUTES)   data-attributes  ->  options object for a create...() function
//   makeTrigger(index)            an invisible reveal fragment that stands for one "next" press
//   isShown(trigger)              has that press happened (is the fragment visible)?
//   manageSlideItems(deck, ...)   create animations lazily, pause them on hidden slides, keep the
//                                 number of live WebGL contexts bounded, follow reveal's scale
//   formatLabel(text)             \nu -> ν, *x* -> italic x  (for captions and axis labels)

export const bool = v => v !== 'false';                     // <div data-grid> or data-grid="true" both mean on
export const numberList = v => String(v).split(',').map(s => Number(s.trim()));
export const stringList = v => String(v).split(',').map(s => s.trim());

/**
 * Read data-attributes into an options object.
 * ATTRIBUTES maps a camelCased data-attribute (the browser turns data-rotation-period into
 * rotationPeriod) to [option name, converter]. data-size="400" sets both width and height.
 */
export function readOptions(el, ATTRIBUTES) {
  const options = {};
  for (const [attr, [option, convert]] of Object.entries(ATTRIBUTES)) {
    if (attr in el.dataset) options[option] = convert(el.dataset[attr]);
  }
  if ('size' in el.dataset) options.width = options.height = Number(el.dataset.size);
  return options;
}

/**
 * An invisible reveal fragment that stands for one step (one press of "next").
 * "custom" stops reveal from fading it in; it takes no space on the slide.
 * index: optional number, placed like data-fragment-index.
 */
export function makeTrigger(index, className = '') {
  const trigger = document.createElement('span');
  trigger.className = `fragment custom step-trigger ${className}`.trim();
  trigger.setAttribute('aria-hidden', 'true');
  trigger.style.cssText = 'position: absolute; width: 0; height: 0; overflow: hidden;';
  if (index !== undefined && index !== '' && !isNaN(index)) trigger.dataset.fragmentIndex = index;
  return trigger;
}

/** If el has the data-attribute `attr` (camelCase), put a trigger right after `after` and return it. */
export function triggerFor(el, attr, after = el) {
  if (!(attr in el.dataset)) return null;
  const trigger = makeTrigger(el.dataset[attr]);
  after.after(trigger);
  return trigger;
}

export const isShown = trigger => !!trigger && trigger.classList.contains('visible');

/** Printing to PDF (?print-pdf)? reveal 6 calls it isPrintView, older versions isPrintingPDF. */
export function isPrinting(deck) {
  const check = deck.isPrintView ?? deck.isPrintingPDF;
  return check ? !!check.call(deck) : false;
}

/**
 * The life cycle shared by all animated elements:
 *  - nothing is created until its slide is first shown (fast start-up, few WebGL contexts),
 *  - animations on hidden slides are paused (stop) and resumed (start) when you come back,
 *  - at most maxLive handles exist; the longest-unseen paused ones are disposed,
 *  - handles get set({ renderScale }) when reveal rescales the slides,
 *  - with ?print-pdf every element is created and frozen.
 *
 * selector  CSS selector of the elements (e.g. '.stellar')
 * hooks
 *   create(item)          -> handle with start / stop / dispose (and optionally set)
 *   onShow(item, isNew)   called each time its slide becomes the current one
 *   onHide(item)          called when its slide stops being the current one
 *   onPrint(item)         called after create() when printing to PDF
 *   prepare(item)         called for items on the neighbouring slides (preload data)
 *   maxLive               default 8 (browsers allow ~16 WebGL contexts)
 * Returns the list of items: { el, slide, handle, shown, lastShown }.
 */
export function manageSlideItems(deck, selector, hooks) {
  const { create, onShow, onHide, onPrint, prepare, maxLive = 8 } = hooks;

  const items = [...deck.getRevealElement().querySelectorAll(selector)].map(el => ({
    el,
    slide: el.closest('section'),
    handle: null,
    shown: false,
    lastShown: 0,
  }));

  function update() {
    const current = deck.getCurrentSlide();

    for (const item of items) {
      if (item.slide === current) {
        const isNew = !item.handle;
        if (isNew) item.handle = create(item);
        else if (!item.shown) item.handle.start?.();
        if (!item.shown) onShow?.(item, isNew);
        item.shown = true;
        item.lastShown = performance.now();
      } else if (item.shown) {
        item.handle?.stop?.();
        onHide?.(item);
        item.shown = false;
      }
    }

    // Keep at most maxLive handles alive: dispose the longest-unseen paused ones
    const paused = items
      .filter(i => i.handle && i.slide !== current)
      .sort((a, b) => a.lastShown - b.lastShown);
    let excess = items.filter(i => i.handle).length - maxLive;
    for (const item of paused) {
      if (excess-- <= 0) break;
      item.handle.dispose?.();
      item.handle = null;                                   // recreated if you come back to it
    }

    // Let items on the slides just before / after get ready (e.g. fetch and decode data)
    if (prepare) {
      const near = neighbourSlides(deck, current);
      for (const item of items) if (near.has(item.slide)) prepare(item);
    }
  }

  deck.on('ready', () => {
    if (isPrinting(deck)) {                             // ?print-pdf shows every slide at once
      for (const item of items) {
        item.handle = create(item);
        item.handle.stop?.();
        onPrint?.(item);
      }
      return;
    }
    update();
  });

  deck.on('slidechanged', update);

  // Keep the render resolution matched to reveal's slide scale (window resize, fullscreen, ...)
  deck.on('resize', e => {
    for (const item of items) item.handle?.set?.({ renderScale: e.scale });
  });

  return items;
}

/** The slides directly before and after `slide` (horizontally and vertically). */
function neighbourSlides(deck, slide) {
  const near = new Set();
  if (!slide) return near;
  const { h, v } = deck.getIndices(slide);
  for (const [dh, dv] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    const s = deck.getSlide(h + dh, dh ? 0 : v + dv);
    if (s) near.add(s);
  }
  return near;
}

/** Reserve an element's final size now (content is created lazily, and reveal centers a slide's
 *  content when it lays the slide out). Centering is done in the theme's CSS. */
export function reserveSize(el, width, height) {
  el.style.width = width + 'px';
  el.style.height = height + 'px';
}

// ---------- Labels ----------

// LaTeX-style names usable in labels as \name
export const SYMBOLS = {
  ell: 'ℓ', nu: 'ν', omega: 'ω', Omega: 'Ω', Delta: 'Δ', delta: 'δ', pi: 'π', theta: 'θ',
  phi: 'φ', mu: 'μ', epsilon: 'ε', tau: 'τ', lambda: 'λ', sigma: 'σ', odot: '☉', sun: '☉',
  deg: '°', times: '×', pm: '±', approx: '≈',
};

/** Replace \name by its symbol (see SYMBOLS). */
export function replaceSymbols(text) {
  return String(text).replace(/\\([A-Za-z]+)/g, (whole, name) => SYMBOLS[name] ?? whole);
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Text -> safe HTML: \name becomes a symbol, *x* becomes italic. */
export function formatLabel(text) {
  return escapeHtml(replaceSymbols(text)).replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

/** Render resolution of a canvas: display pixel ratio x slide scale, capped at a 4096-pixel buffer. */
export function pixelRatio(renderScale, width, height) {
  return Math.min(window.devicePixelRatio * renderScale, 4096 / Math.max(width, height));
}
