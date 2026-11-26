// plugins/graphPlugin.js
//
// Turns every <div class="graph" data-...> into an animated graph (see graph.js) of
//   - a light curve or any table of numbers:   data-src="data/spb.csv"
//   - an audio file (its waveform):            data-src="media/a-string.mp3"
//   - a formula:                               data-fn="A*sin(2*PI*t/T)"
// shown as a time series (data-mode="time", default) or as its spectrum (data-mode="fourier").
//
// Steps while presenting (all driven by reveal's "next", undone by "back"):
//   data-play-step on the graph       the trace (and its sound) starts on a press instead of on arrival
//   child elements, e.g.
//     <span class="fragment graph-arrow" data-from="0.5,1.1" data-to="2.5,1.1">T = 2 s</span>
//     <span class="fragment graph-zoom"  data-x="0,6"></span>
//   appear (or zoom) on their press. Children without class="fragment" are always shown.
//
// Full attribute list with examples: docs/graph.md
import { createGraph } from './graph.js';
import {
  loadSeries, seriesFromFunction, cachedSpectrum, isAudioFile,
  TIME_UNITS, FREQ_UNITS, UNIT_LABELS,
} from './timeseries.js';
import {
  bool, numberList, stringList, readOptions, makeTrigger, isShown, isPrinting, manageSlideItems, reserveSize,
} from './lib/revealHelpers.js';

const range = v => (v === 'auto' || v === '' ? null : numberList(v));

// data-attribute (camelCased) -> [option name, converter]. Options for createGraph, plus the ones
// this plugin uses itself (data source, units, audio).
const ATTRIBUTES = {
  // data source
  src:          ['src',          String],
  fn:           ['fn',           String],
  t:            ['fnRange',      numberList],   // data-t="0,10": formula sampled from t = 0 to 10 s
  dt:           ['fnStep',       Number],       // ... every dt seconds
  amplitude:    ['A',            Number],       // A and T inside the formula
  period:       ['T',            Number],
  noise:        ['noise',        Number],       // Gaussian "measurement" noise added to the formula
  seed:         ['seed',         Number],
  columns:      ['columns',      String],
  timeUnit:     ['timeUnit',     String],
  timeZero:     ['timeZero',     String],
  // what to show
  mode:         ['mode',         String],
  xUnit:        ['xUnit',        String],
  yScale:       ['yScale',       Number],
  subtractMean: ['subtractMean', bool],
  oversample:   ['oversample',   Number],
  // audio
  audio:        ['audio',        String],
  audioSync:    ['audioSync',    String],
  audioVolume:  ['audioVolume',  Number],
  audioMax:     ['audioMax',     Number],       // stop the sound (and the trace) after this many seconds
  duration:     ['duration',     v => (isNaN(v) ? v : Number(v))],   // seconds | 'realtime'
  speed:        ['speed',        Number],
  // createGraph options
  x:            ['xRange',       range],
  y:            ['yRange',       range],
  xStep:        ['xStep',        Number],
  yStep:        ['yStep',        Number],
  yLog:         ['yLog',         bool],
  yLogDecades:  ['yLogDecades',  Number],
  yFromZero:    ['yFromZero',    bool],
  style:        ['style',        String],
  color:        ['color',        String],
  lineWidth:    ['lineWidth',    Number],
  fill:         ['fill',         Number],
  pointColor:   ['pointColor',   String],
  pointRadius:  ['pointRadius',  Number],
  ball:         ['ball',         bool],
  ballColor:    ['ballColor',    String],
  ballRadius:   ['ballRadius',   Number],
  animate:      ['animate',      String],
  zoomDuration: ['zoomDuration', Number],
  axisColor:    ['axisColor',    String],
  axisWidth:    ['axisWidth',    Number],
  axisArrows:   ['axisArrows',   bool],
  textColor:    ['textColor',    String],
  fontSize:     ['fontSize',     Number],
  tickFontSize: ['tickFontSize', Number],
  tickSize:     ['tickSize',     Number],
  ticks:        ['ticks',        bool],
  xLabel:       ['xLabel',       String],
  yLabel:       ['yLabel',       String],
  padding:      ['padding',      numberList],
  width:        ['width',        Number],
  height:       ['height',       Number],
};

// Options that belong to this plugin, not to createGraph
const PLUGIN_ONLY = ['src', 'fn', 'fnRange', 'fnStep', 'A', 'T', 'noise', 'seed', 'columns', 'timeUnit',
  'timeZero', 'mode', 'xUnit', 'yScale', 'subtractMean', 'oversample', 'audio', 'audioSync', 'audioVolume',
  'audioMax', 'speed', 'duration'];

// ---------- settings with defaults filled in ----------

function settings(el) {
  const o = readOptions(el, ATTRIBUTES);
  const fourier = o.mode === 'fourier';
  const fromAudio = o.src && isAudioFile(o.src);
  const timeUnit = o.timeUnit ?? (o.src && !fromAudio ? 'd' : 's');
  const xUnit = o.xUnit ?? (fourier ? (timeUnit === 's' ? 'Hz' : 'c/d') : timeUnit);
  const units = fourier ? FREQ_UNITS : TIME_UNITS;
  if (!(xUnit in units)) console.warn(`graph: unknown x unit "${xUnit}" (use ${Object.keys(units).join(', ')})`);
  const unitText = UNIT_LABELS[xUnit] ?? xUnit;

  const graph = {
    yFromZero: fourier,
    xLabel: fourier ? `Frequency [${unitText}]` : `Time [${unitText}]`,
    yLabel: fourier ? 'Amplitude' : 'Signal',
    duration: fourier ? 3 : 4,
    ...Object.fromEntries(Object.entries(o).filter(([k]) => !PLUGIN_ONLY.includes(k))),
  };

  // The audio that goes with the trace: data-audio="file", or data-audio alone = the source itself
  let audio = o.audio;
  if (audio === '' || audio === 'self' || audio === 'true') audio = fromAudio ? o.src : null;
  const audioSync = o.audioSync ?? (audio && audio === o.src && !fourier ? 'time' : 'progress');

  return {
    ...o, fourier, fromAudio, timeUnit, xUnit, audio, audioSync, graph,
    unitSeconds: fourier ? FREQ_UNITS[xUnit] : TIME_UNITS[xUnit],   // seconds per x unit (time) / Hz per x unit (fourier)
    subtractMean: o.subtractMean ?? false,
    yScale: o.yScale ?? 1,
  };
}

// ---------- data, converted to display units ----------

function seriesFor(s) {
  if (s.fn) {
    const [t0, t1] = s.fnRange ?? [0, s.fourier ? 100 : 10];
    return Promise.resolve(seriesFromFunction(s.fn, {
      t0, t1, dt: s.fnStep ?? 0.05, A: s.A ?? 1, T: s.T ?? 2, noise: s.noise ?? 0, seed: s.seed ?? 1,
    }));
  }
  if (!s.src) return Promise.reject(new Error('no data-src or data-fn given'));
  return loadSeries(s.src, { columns: s.columns, timeUnit: s.timeUnit, timeZero: s.timeZero });
}

function sourceKey(s) {
  return s.fn ? `fn|${s.fn}|${s.fnRange}|${s.fnStep}|${s.A}|${s.T}|${s.noise}|${s.seed}`
              : `src|${s.src}|${s.columns}|${s.timeUnit}|${s.timeZero}`;
}

async function displayData(s, zoomMax) {
  const series = seriesFor(s);
  if (!s.fourier) {
    const { t, y } = await series;
    let mean = 0;
    if (s.subtractMean) for (const v of y) mean += v / y.length;
    return {
      x: Float64Array.from(t, v => v / s.unitSeconds),
      y: Float64Array.from(y, v => (v - mean) * s.yScale),
    };
  }
  const { f, a } = await cachedSpectrum(sourceKey(s), series, { oversample: s.oversample ?? 4 });
  // Keep only what can be shown (spectra of audio files have half a million points)
  const fMax = zoomMax ? zoomMax * 1.05 * s.unitSeconds : Infinity;
  let n = f.length;
  while (n > 2 && f[n - 1] > fMax) n--;
  return {
    x: Float64Array.from(f.subarray(0, n), v => v / s.unitSeconds),
    y: Float64Array.from(a.subarray(0, n), v => v * s.yScale),
  };
}

// ---------- annotations from child elements ----------

const TYPES = ['arrow', 'line', 'band', 'label', 'zoom'];

function readAnnotation(child) {
  const type = TYPES.find(t => child.classList.contains(`graph-${t}`));
  if (!type) return null;
  const d = child.dataset;
  const text = d.label ?? (child.textContent.trim() || undefined);
  const a = { type, el: child, fragment: child.classList.contains('fragment'), visible: false };
  if (d.color) a.color = d.color;
  if (d.width) a.width = Number(d.width);
  if (d.size) a.size = Number(d.size);

  if (type === 'arrow') {
    Object.assign(a, { from: numberList(d.from), to: numberList(d.to), heads: d.heads, label: text });
    if (d.labelOffset) a.labelOffset = numberList(d.labelOffset);
    if (d.labelAlign) a.labelAlign = d.labelAlign;
  } else if (type === 'line') {
    if (d.x) a.x = numberList(d.x);
    if (d.y) a.y = numberList(d.y);
    if (d.labels) a.labels = stringList(d.labels);
    if (d.dash) a.dash = d.dash === 'none' ? [] : numberList(d.dash);
  } else if (type === 'band') {
    Object.assign(a, { x: numberList(d.x), label: text });
    if (d.y) a.y = numberList(d.y);
    if (d.opacity) a.opacity = Number(d.opacity);
  } else if (type === 'label') {
    // y may be a number, or 'top' / 'bottom' (just inside the plot, whatever the data's scale)
    const [x, y] = stringList(d.at);
    Object.assign(a, { at: [Number(x), isNaN(y) ? y : Number(y)], text, align: d.align, bold: 'bold' in d });
  } else if (type === 'zoom') {
    a.view = {
      x: d.x ? numberList(d.x) : null,
      y: d.y && d.y !== 'auto' ? numberList(d.y) : null,
      xStep: d.xStep ? Number(d.xStep) : null,
      yStep: d.yStep ? Number(d.yStep) : null,
    };
    if (d.duration) a.duration = Number(d.duration);
  }
  return a;
}

// The play step goes inside the graph, before the annotation children, so that in document order
// (= the order of the presses) the trace comes first and zooms / arrows after it.
function playTrigger(el) {
  if (!('playStep' in el.dataset)) return null;
  const trigger = makeTrigger(el.dataset.playStep);
  el.prepend(trigger);
  return trigger;
}

// ---------- the plugin ----------

export const GraphPlugin = {
  id: 'graph',

  init(deck) {
    const owner = new Map();                         // fragment element -> item state

    // Set up every graph before reveal collects the fragments
    const states = new Map();                        // element -> state
    for (const el of deck.getRevealElement().querySelectorAll('.graph')) {
      const s = settings(el);
      reserveSize(el, s.graph.width ?? 900, s.graph.height ?? 450);
      const annotations = [...el.children].map(readAnnotation).filter(Boolean);
      for (const a of annotations) if (a.fragment) a.el.classList.add('custom');
      const zoomMax = Math.max(s.graph.xRange?.[1] ?? -Infinity,
        ...annotations.filter(a => a.type === 'zoom' && a.view.x).map(a => a.view.x[1]));
      const state = {
        s, annotations,
        zoomMax: Number.isFinite(zoomMax) ? zoomMax : null,
        playStep: playTrigger(el),
        playing: false,                              // has the play step's trace been started?
        audio: null,
        data: null,                                  // Promise of the display data
      };
      states.set(el, state);
      for (const a of annotations) if (a.fragment) owner.set(a.el, state);
      if (state.playStep) owner.set(state.playStep, state);
    }

    const load = state => (state.data ??= displayData(state.s, state.zoomMax));

    // ---- audio ----
    function getAudio(state) {
      if (!state.s.audio) return null;
      if (!state.audio) {
        state.audio = new Audio(state.s.audio);
        state.audio.preload = 'auto';
        state.audio.volume = state.s.audioVolume ?? 1;
      }
      return state.audio;
    }

    function stopAudio(state) {
      if (!state.audio) return;
      state.audio.pause();
      state.audio.currentTime = 0;
    }

    // Start the trace (and the sound) over the current x window.
    //   sound of the source itself (audioSync 'time'): the tip of the curve follows the sound's time
    //   other sound (audioSync 'progress'): the trace takes as long as the sound (or data-duration)
    //   no sound: data-duration seconds, or 'realtime' = as fast as the time axis itself
    async function play(state, g) {
      const { s } = state;
      const win = g.targetWindow();
      const audio = getAudio(state);

      if (!audio) {
        const duration = s.duration === 'realtime' && !s.fourier
          ? (win[1] - win[0]) * s.unitSeconds / (s.speed ?? 1)
          : (typeof s.duration === 'number' ? s.duration : s.graph.duration);
        g.play({ duration });
        return;
      }

      g.clear();
      if (!(audio.duration > 0)) {
        await new Promise(r => audio.addEventListener('loadedmetadata', r, { once: true }));
      }
      if (!state.playing && state.playStep) return;   // went back while the sound was loading
      const max = s.audioMax ?? Infinity;
      audio.currentTime = 0;
      audio.play().catch(err => console.warn('graph: could not play audio', err));
      if (Number.isFinite(max)) {
        const stopAt = () => {
          if (audio.currentTime >= max) { audio.pause(); audio.removeEventListener('timeupdate', stopAt); }
        };
        audio.addEventListener('timeupdate', stopAt);
      }

      if (s.audioSync === 'time') {
        const t0 = win[0] * s.unitSeconds;
        g.play({ duration: (win[1] - win[0]) * s.unitSeconds, clock: () => audio.currentTime - t0 });
      } else {
        const duration = typeof s.duration === 'number' ? s.duration : Math.min(audio.duration, max);
        g.play({ duration, clock: () => audio.currentTime });
      }
    }

    // Bring a graph to the state that its shown fragments call for
    function apply(state, item, arriving) {
      const h = item.handle;
      if (!h || !h.hasData) return;
      // reveal's own fragment styles work too: fade-out = shown until its press,
      // fade-in-then-out = shown only until the next press
      const shown = a => {
        if (!a.fragment) return true;
        const c = a.el.classList;
        if (c.contains('fade-in-then-out')) return c.contains('current-fragment');
        if (c.contains('fade-out')) return !isShown(a.el);
        return isShown(a.el);
      };

      // Annotations
      for (const a of state.annotations) a.visible = shown(a);
      if (arriving) h.snapAnnotations(); else h.redraw();

      // Zoom: the last shown zoom step wins
      const zooms = state.annotations.filter(a => a.type === 'zoom' && a.fragment && isShown(a.el));
      const z = zooms.sort((p, q) => Number(p.el.dataset.fragmentIndex) - Number(q.el.dataset.fragmentIndex)).pop();
      h.setView(z ? z.view : null, arriving ? 0 : (z?.duration ?? state.s.graph.zoomDuration ?? 1.2));

      // Trace
      if (state.playStep) {
        const want = isShown(state.playStep);
        if (want && !state.playing) {
          state.playing = true;
          if (arriving) h.showAll(); else play(state, h);   // coming back to a slide: no replay
        } else if (!want) {
          state.playing = false;
          stopAudio(state);
          h.clear();
        }
      } else if (arriving) {
        play(state, h);
      }
    }

    const items = manageSlideItems(deck, '.graph', {
      maxLive: 24,                                   // plain canvases, not WebGL: more may stay alive
      create: item => {
        const state = states.get(item.el);
        const g = createGraph(item.el, {
          ...state.s.graph,
          annotations: state.annotations.filter(a => a.type !== 'zoom'),
          renderScale: deck.getScale(),
        });
        load(state).then(d => {
          if (item.handle !== g) return;             // disposed in the meantime
          g.setData(d);
          if (isPrinting(deck)) {
            for (const a of state.annotations) a.visible = true;
            g.snapAnnotations();
            g.showAll();
          } else if (item.shown) {
            apply(state, item, true);
          }
        }).catch(err => {
          console.error(`graph (${state.s.src ?? state.s.fn}):`, err);
          g.setMessage(`⚠ ${err.message}`, true);
        });
        return g;
      },
      onShow: item => {
        const state = states.get(item.el);
        state.playing = false;
        apply(state, item, true);
      },
      onHide: item => stopAudio(states.get(item.el)),
      prepare: item => load(states.get(item.el)).catch(() => {}),
    });

    // A step was shown or hidden
    function onFragments(e) {
      const touched = new Set(e.fragments.map(f => owner.get(f)).filter(Boolean));
      for (const item of items) {
        const state = states.get(item.el);
        if (touched.has(state) && item.shown) apply(state, item, false);
      }
    }
    deck.on('fragmentshown', onFragments);
    deck.on('fragmenthidden', onFragments);
  },
};
