// plugins/propsPlugin.js
//
// Simple flat drawings ("props") for the slides, placed like the other objects:
//
//   <div class="microphone"   data-x="0.32" data-y="0.58" data-height="340"></div>
//   <div class="clapperboard" data-x="0.66" data-y="0.6"  data-height="320" data-open="12"></div>
//
// data-x, data-y   where its centre goes, as a fraction of the slide (0..1); data-anchor as for text
// data-height      its height in slide px (the width follows from the drawing)
// data-open        clapperboard only: how far the top bar is open, in degrees (0 = shut)
// class="fragment" makes it appear on a press, as usual. Full list: docs/props.md
import { placeOnSlide } from './lib/revealHelpers.js';

let uid = 0;                                         // unique ids for each drawing's clip path

// Each prop: its viewBox size, default height (px) and the SVG inside
const PROPS = {
  microphone: {
    size: [200, 340],
    height: 340,
    svg: () => {
      const id = `mic-ball-${uid++}`;
      return `
        <defs><clipPath id="${id}"><circle cx="100" cy="78" r="62"/></clipPath></defs>
        <path d="M66 192 L134 192 L118 326 Q100 332 82 326 Z" fill="#262a33" stroke="#0b0d12" stroke-width="3"/>
        <path d="M64 146 L136 146 L134 192 L66 192 Z" fill="#262a33" stroke="#0b0d12" stroke-width="3"/>
        <circle cx="100" cy="78" r="62" fill="#c3c8d2"/>
        <g clip-path="url(#${id})" stroke="#979eab" stroke-width="1.5">
          <path d="M0 40 L120 160 M0 16 L144 160 M0 -8 L168 160 M8 -24 L192 160 M32 -24 L216 160 M56 -24 L240 160 M80 -24 L264 160 M104 -24 L288 160"/>
          <path d="M200 40 L80 160 M200 16 L56 160 M200 -8 L32 160 M192 -24 L8 160 M168 -24 L-16 160 M144 -24 L-40 160 M120 -24 L-64 160 M96 -24 L-88 160"/>
        </g>
        <circle cx="100" cy="78" r="62" fill="none" stroke="#0b0d12" stroke-width="3"/>
        <rect x="34" y="68" width="132" height="12" rx="4" fill="#a7adb9" stroke="#0b0d12" stroke-width="3"/>
        <rect x="60" y="134" width="80" height="13" rx="3" fill="#a7adb9" stroke="#0b0d12" stroke-width="3"/>`;
    },
  },
  clapperboard: {
    size: [260, 230],
    height: 320,
    // the open bar swings up past the top of the drawing: widen the view upward to keep it in
    top: el => {
      const a = Number(el.dataset.open ?? 12) * Math.PI / 180;
      return Math.min(0, Math.floor(60 - 220 * Math.sin(a) - 24 * Math.cos(a) - 4));
    },
    svg: el => {
      const open = Number(el.dataset.open ?? 12);
      return `
        <rect x="20" y="84" width="220" height="130" rx="6" fill="#20232c" stroke="#0b0d12" stroke-width="3"/>
        <rect x="20" y="60" width="220" height="24" fill="#f4f6fa" stroke="#0b0d12" stroke-width="3"/>
        <path d="M40 60 L64 60 L88 84 L64 84 Z M92 60 L116 60 L140 84 L116 84 Z M144 60 L168 60 L192 84 L168 84 Z M196 60 L220 60 L240 80 L240 84 L220 84 Z" fill="#20232c"/>
        <g transform="rotate(${-open} 20 60)">
          <rect x="20" y="36" width="220" height="24" fill="#f4f6fa" stroke="#0b0d12" stroke-width="3"/>
          <path d="M20 36 L36 36 L60 60 L20 60 Z M88 36 L112 36 L136 60 L112 60 Z M140 36 L164 36 L188 60 L164 60 Z M192 36 L216 36 L240 60 L216 60 Z" fill="#20232c"/>
        </g>
        <circle cx="20" cy="60" r="5" fill="#9aa3b5" stroke="#0b0d12" stroke-width="2"/>`;
    },
  },
};

export const PropsPlugin = {
  id: 'props',

  init(deck) {
    for (const [name, prop] of Object.entries(PROPS)) {
      for (const el of deck.getRevealElement().querySelectorAll(`.slides .${name}`)) {
        const top = prop.top?.(el) ?? 0;              // below 0: the drawing reaches above its box
        const [w, h0] = prop.size;
        const h = h0 - top;
        const height = Number(el.dataset.height ?? prop.height);
        const width = Math.round(height * w / h);
        el.classList.add('prop');
        el.innerHTML = `<svg viewBox="0 ${top} ${w} ${h}" width="${width}" height="${height}" role="img" aria-label="${name}">${prop.svg(el)}</svg>`;
        if (!('x' in el.dataset) && !('y' in el.dataset)) el.dataset.x = el.dataset.y = '0.5';
        placeOnSlide(el, deck);
      }
    }
  },
};
