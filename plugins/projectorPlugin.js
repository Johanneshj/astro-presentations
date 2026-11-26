// plugins/projectorPlugin.js
//
// Projector colours. A projector shows less contrast than a laptop screen and clips the brightest
// tones: near-white details (a hot star's mottling, the grid on a spherical harmonic) all become the
// same white, and colours look washed out. Projector mode puts one colour adjustment on the whole
// deck (starfield included):
//   brightness < 1   pulls the near-whites back below the point where the projector clips them
//   saturation > 1   gives the colours back what the projector washes out
//   contrast         a little more (or less) spread between dark and light
//
//   D          projector mode on / off
//   Shift+D    a small panel with sliders, to tune it in the room (on the projector itself)
//   ?projector=1 / ?projector=0 in the URL: on / off for this page
//
// The settings (and whether it is on) are remembered in this browser. Starting values: the
// "projector" option of Reveal.initialize, e.g. projector: { brightness: 0.85, saturation: 1.3 }.
// Full description: docs/projector.md

const STORE = 'astro-projector';
const DEFAULTS = { on: false, brightness: 0.85, saturation: 1.3, contrast: 1.05 };
const SLIDERS = [                                  // [key, label, min, max, step]
  ['brightness', 'Brightness', 0.5, 1.2, 0.01],
  ['saturation', 'Saturation', 0.5, 2.5, 0.01],
  ['contrast',   'Contrast',   0.6, 1.6, 0.01],
];

function load(fallback) {
  try { return { ...fallback, ...JSON.parse(localStorage.getItem(STORE) ?? '{}') }; }
  catch { return { ...fallback }; }
}
function save(s) {
  try { localStorage.setItem(STORE, JSON.stringify(s)); } catch { /* private window: not remembered */ }
}

export const ProjectorPlugin = {
  id: 'projector',

  init(deck) {
    const base = { ...DEFAULTS, ...(deck.getConfig().projector ?? {}) };
    const s = load(base);
    const param = new URLSearchParams(location.search).get('projector');
    if (param !== null) s.on = !['0', 'false', 'off'].includes(param.toLowerCase());
    const target = deck.getRevealElement();

    function apply() {
      target.style.filter = s.on
        ? `brightness(${s.brightness}) saturate(${s.saturation}) contrast(${s.contrast})`
        : '';
      panel?.refresh();
    }

    // ---- the tuning panel (Shift+D) ----
    let panel = null;
    function makePanel() {
      const box = document.createElement('div');
      box.className = 'projector-panel';
      box.style.cssText = 'position: fixed; right: 16px; bottom: 16px; z-index: 1000; padding: 12px 14px;'
        + ' background: rgba(10, 14, 30, 0.92); color: #fff; font: 14px/1.4 sans-serif; border-radius: 8px;'
        + ' border: 1px solid rgba(255, 255, 255, 0.25); min-width: 260px;';
      const head = document.createElement('label');
      head.style.cssText = 'display: flex; gap: 8px; align-items: center; font-weight: bold; margin-bottom: 6px;';
      const onBox = document.createElement('input');
      onBox.type = 'checkbox';
      onBox.addEventListener('change', () => { s.on = onBox.checked; save(s); apply(); });
      head.append(onBox, 'Projector colours (D)');
      box.append(head);
      const inputs = {};
      for (const [key, label, min, max, step] of SLIDERS) {
        const row = document.createElement('label');
        row.style.cssText = 'display: grid; grid-template-columns: 80px 1fr 40px; gap: 8px; align-items: center;';
        const input = Object.assign(document.createElement('input'), { type: 'range', min, max, step });
        const value = document.createElement('span');
        input.addEventListener('input', () => { s[key] = Number(input.value); s.on = true; save(s); apply(); });
        row.append(label, input, value);
        box.append(row);
        inputs[key] = { input, value };
      }
      const buttons = document.createElement('div');
      buttons.style.cssText = 'display: flex; justify-content: space-between; margin-top: 8px;';
      const reset = Object.assign(document.createElement('button'), { textContent: 'Reset' });
      reset.addEventListener('click', () => { Object.assign(s, base, { on: true }); save(s); apply(); });
      const close = Object.assign(document.createElement('button'), { textContent: 'Close (Shift+D)' });
      close.addEventListener('click', () => togglePanel());
      buttons.append(reset, close);
      box.append(buttons);
      document.body.appendChild(box);                // outside the deck: it is not filtered itself
      return {
        box,
        refresh() {
          onBox.checked = s.on;
          for (const [key] of SLIDERS) {
            inputs[key].input.value = s[key];
            inputs[key].value.textContent = Number(s[key]).toFixed(2);
          }
        },
      };
    }
    function togglePanel() {
      if (panel) { panel.box.remove(); panel = null; return; }
      panel = makePanel();
      panel.refresh();
    }

    deck.addKeyBinding({ keyCode: 68, key: 'D', description: 'Projector colours on / off (Shift+D: tune)' }, () => {
      s.on = !s.on;
      save(s);
      apply();
    });
    // Shift+D (reveal's key bindings ignore modifiers, so this one is caught before reveal sees it)
    window.addEventListener('keydown', e => {
      if ((e.code === 'KeyD' || e.key?.toLowerCase() === 'd') && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        e.stopImmediatePropagation();
        togglePanel();
      }
    }, true);

    apply();
  },
};
