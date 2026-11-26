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
// The speaker view (S) runs two more copies of the deck in small frames: the current slide and the
// next one. Those copies keep few items alive and get no warm-up; the "next slide" copy shows a still
// (it animates for a moment, to settle, then stops), so the presenter's computer does far less work.
const search = typeof location === 'undefined' ? '' : location.search;
const inSpeakerView = /(\?|&)receiver/i.test(search);
const isNextPreview = inSpeakerView && /controls=false/i.test(search);

export function manageSlideItems(deck, selector, hooks) {
  const { create, onShow, onHide, onPrint, prepare } = hooks;
  const maxLive = inSpeakerView ? Math.min(hooks.maxLive ?? 8, 4) : (hooks.maxLive ?? 8);

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
        if (!item.shown && isNextPreview) {
          setTimeout(() => { if (!item.shown || item.slide !== deck.getCurrentSlide()) return; item.handle?.stop?.(); }, 500);
        }
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

  // Warm-up: creating an item (WebGL context, shaders, textures) takes tens of ms. Done on arrival it
  // lands right at the start of the slide transition and makes it stutter. So once a transition has
  // finished, the items of the neighbouring slides are created in idle time, one at a time, and paused;
  // arriving there then only resumes them.
  let warmJob = null;
  const idle = cb => (window.requestIdleCallback ? requestIdleCallback(cb, { timeout: 500 }) : setTimeout(cb, 50));
  const cancelIdle = id => (window.cancelIdleCallback ? cancelIdleCallback(id) : clearTimeout(id));
  function warmNext() {
    warmJob = null;
    const current = deck.getCurrentSlide();
    const near = neighbourSlides(deck, current);
    const item = items.find(i => !i.handle && near.has(i.slide));
    if (!item) return;
    if (items.filter(i => i.handle).length >= maxLive) {
      // make room only by dropping an item that is neither here nor next door
      const old = items
        .filter(i => i.handle && i.slide !== current && !near.has(i.slide))
        .sort((a, b) => a.lastShown - b.lastShown)[0];
      if (!old) return;
      old.handle.dispose?.();
      old.handle = null;
    }
    item.handle = create(item);
    item.handle.stop?.();
    item.lastShown = performance.now();
    warmJob = idle(warmNext);
  }
  function scheduleWarm() {
    if (warmJob !== null || isPrinting(deck) || inSpeakerView) return;
    warmJob = idle(warmNext);
  }
  let warmTimer = null;
  deck.on('slidechanged', () => {
    if (warmJob !== null) { cancelIdle(warmJob); warmJob = null; }
    clearTimeout(warmTimer);
    warmTimer = setTimeout(scheduleWarm, 1000);      // in case no transitionend comes
  });
  deck.on('slidetransitionend', () => { clearTimeout(warmTimer); scheduleWarm(); });
  deck.on('ready', () => { warmTimer = setTimeout(scheduleWarm, 1000); });

  // Keep the render resolution matched to reveal's slide scale (window resize, fullscreen, ...)
  deck.on('resize', e => {
    for (const item of items) item.handle?.set?.({ renderScale: e.scale });
  });
  // ... and to the screen's pixel density (the window moved to another monitor without resizing)
  const watchDensity = () => {
    matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener('change', () => {
      for (const item of items) item.handle?.set?.({ renderScale: deck.getScale() });
      watchDensity();
    }, { once: true });
  };
  watchDensity();

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
 *  content when it lays the slide out). Centering is done in the theme's CSS.
 *  With deck given, warns when the element alone is wider or taller than the slide. */
export function reserveSize(el, width, height, deck) {
  el.style.width = width + 'px';
  el.style.height = height + 'px';
  const slide = deck?.getConfig();
  if (slide && (width > slide.width || height > slide.height)) {
    console.warn(`${el.className} is ${width} x ${height} px, larger than the ${slide.width} x ${slide.height} slide;`
      + ' it will stick out. Use a smaller data-height (and data-radius to make the star itself bigger).', el);
  }
}

/** The slide box of a star: its square canvas (size c, slide px: the star plus room for its whole glow
 *  or pulsation), plus room for a label below it if it has one. */
export function starBox(el, c, deck, labelled = false) {
  el.classList.add('star-box');
  el.style.boxSizing = 'content-box';
  el.style.width = el.style.height = c + 'px';
  el.style.paddingBottom = labelled ? 'calc(1em + 6px)' : '0';
  const slide = deck?.getConfig();
  if (slide && (c > slide.width || c > slide.height)) {
    console.warn(`${el.className}: ${c} px with its glow, larger than the ${slide.width} x ${slide.height} slide;`
      + ' use a smaller data-radius (or data-glow-size).', el);
  }
}

// ---------- Free placement: data-x / data-y ----------
// <div class="stellar" data-size="200" data-x="0.25" data-y="0.6">: the element's centre (for a star:
// the star's centre) goes to 25 % of the slide's width from the left and 60 % of its height from the
// top. It leaves the flow of the slide, so the rest of the slide lays out as if it were not there.
// Only for elements whose plugin calls placeOnSlide (graphs use data-x / data-y for their axes).
// data-anchor="top-left" (top, bottom, left, right, top-right, bottom-left, ...; default centre) puts that
// point of the element at x, y instead of its centre.

const placed = [];                                   // [{ el, x, y, ax, ay }]
const ANCHORS = { left: [0, null], right: [1, null], top: [null, 0], bottom: [null, 1], center: [null, null], centre: [null, null] };

// data-anchor -> [ax, ay]: fractions of the element's width / height (0.5, 0.5 = its centre)
function readAnchor(el) {
  const words = (el.dataset.anchor ?? '').toLowerCase().split(/[\s-]+/).filter(Boolean);
  let ax = 0.5, ay = 0.5;
  for (const w of words) {
    if (!(w in ANCHORS)) { console.warn(`data-anchor: unknown "${w}" (use top, bottom, left, right, center)`, el); continue; }
    const [x, y] = ANCHORS[w];
    if (x !== null) ax = x;
    if (y !== null) ay = y;
  }
  return [ax, ay];
}
let placingDeck = null;

/** Read data-x / data-y (0..1) of el and keep it at that spot of the slide. */
export function placeOnSlide(el, deck) {
  const read = v => (v === undefined || v === '' ? null : Number(v));
  const x = read(el.dataset.x), y = read(el.dataset.y);
  if (x === null && y === null) return;
  for (const [name, v] of [['data-x', x], ['data-y', y]]) {
    if (v !== null && !(v >= 0 && v <= 1)) console.warn(`${name}="${v}" is outside 0..1 (a fraction of the slide)`, el);
  }
  el.style.position = 'absolute';
  el.style.margin = '0';
  const [ax, ay] = readAnchor(el);
  placed.push({ el, x: x ?? 0.5, y: y ?? 0.5, ax, ay });
  if (placingDeck === deck) return;
  placingDeck = deck;
  // now, and once more on the next frame: reveal may still be laying the slides out
  const update = () => { updatePlaced(deck); requestAnimationFrame(() => updatePlaced(deck)); };
  for (const event of ['ready', 'slidechanged', 'resize']) deck.on(event, update);
  document.fonts?.ready.then(update);                // text changes size once its web font has loaded
}

function updatePlaced(deck) {
  const { width: W, height: H } = deck.getConfig();
  const slides = deck.getSlidesElement();
  const offsetIn = node => {                         // node's position within the slide area
    let ox = 0, oy = 0;
    for (let p = node; p && p !== slides; p = p.offsetParent) { ox += p.offsetLeft; oy += p.offsetTop; }
    return [ox, oy];
  };
  for (const { el, x, y, ax, ay } of placed) {
    if (!el.offsetParent) continue;                  // on a hidden slide: done when it comes near
    // Placed elements leave the slide's flow, so the slide (section) can end up much shorter than the
    // slide area, or empty. reveal zooms / rotates a slide about the middle of the section, which would
    // then be near the top: keep that centre in the middle of the slide area instead.
    const section = el.closest('section');
    if (section) section.style.transformOrigin = `50% ${H / 2 - offsetIn(section)[1]}px`;
    el.style.left = el.style.top = '0px';
    // Where the element's positioning box sits within the slide area (reveal centres sections
    // vertically, and the element may sit inside a row, corner, ...)
    let ox = 0, oy = 0;
    for (let p = el.offsetParent; p && p !== slides; p = p.offsetParent) { ox += p.offsetLeft; oy += p.offsetTop; }
    const w = el.offsetWidth;
    const h = el.classList.contains('star-box') ? w : el.offsetHeight;   // star: its square, not the label
    el.style.left = `${x * W - ax * w - ox}px`;
    el.style.top = `${y * H - ay * h - oy}px`;
  }
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
