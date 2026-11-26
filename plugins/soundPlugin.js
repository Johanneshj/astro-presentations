// plugins/soundPlugin.js
//
// Play a sound on a press of "next":
//   <span class="fragment" data-sound="media/g-chord.mp3"></span>
// "back" stops it, and so does leaving the slide. Options on the same element:
//   data-sound-volume="0.8"   0..1
//   data-sound-max="20"       stop (with a short fade) after this many seconds
//   data-sound-start="5"      start this many seconds into the file
// A sound that should start as soon as the slide shows: put data-sound on the <section> itself.
// (For a sound that goes with a graph, use data-audio on the graph instead; see docs/graph.md.)

const FADE = 0.8;      // seconds of fade-out when a sound is stopped early

export const SoundPlugin = {
  id: 'sound',

  init(deck) {
    const players = new Map();                       // element -> Audio

    for (const el of deck.getRevealElement().querySelectorAll('[data-sound]')) {
      if (el.matches('.fragment')) el.classList.add('custom');   // nothing to fade in visually
      if (el.matches('span:empty')) el.style.cssText += 'position: absolute; width: 0; height: 0;';
    }

    function player(el) {
      if (!players.has(el)) {
        const a = new Audio(el.dataset.sound);
        a.preload = 'auto';
        players.set(el, a);
      }
      return players.get(el);
    }

    function play(el) {
      const a = player(el);
      clearInterval(a._fade);
      a.volume = Number(el.dataset.soundVolume ?? 1);
      a.currentTime = Number(el.dataset.soundStart ?? 0);
      a.play().catch(err => console.warn(`sound: could not play ${el.dataset.sound}`, err));
      const max = Number(el.dataset.soundMax);
      if (max > 0) {
        clearTimeout(a._timer);
        a._timer = setTimeout(() => stop(el), max * 1000);
      }
    }

    function stop(el) {
      const a = players.get(el);
      if (!a || a.paused) return;
      clearTimeout(a._timer);
      clearInterval(a._fade);
      const v0 = a.volume, t0 = performance.now();
      a._fade = setInterval(() => {
        const p = (performance.now() - t0) / 1000 / FADE;
        if (p >= 1) { clearInterval(a._fade); a.pause(); a.volume = v0; return; }
        a.volume = v0 * (1 - p);
      }, 30);
    }

    deck.on('fragmentshown', e => e.fragments.forEach(f => 'sound' in f.dataset && play(f)));
    deck.on('fragmenthidden', e => e.fragments.forEach(f => 'sound' in f.dataset && stop(f)));

    deck.on('slidechanged', e => {
      for (const el of players.keys()) if (!e.currentSlide.contains(el)) stop(el);
      if (e.currentSlide.matches('[data-sound]')) play(e.currentSlide);
    });
    deck.on('ready', e => {
      if (e.currentSlide?.matches('[data-sound]')) play(e.currentSlide);
    });
  },
};
