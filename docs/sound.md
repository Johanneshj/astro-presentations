# Sound plugin

File: `plugins/soundPlugin.js`.

Play a sound on a press of "next":

```html
<span class="fragment" data-sound="media/g-chord.mp3"></span>
```

"back" stops it, and so does leaving the slide. A sound that should start as soon as a slide shows:
put `data-sound` on the `<section>` itself.

| Attribute | Default | Meaning |
|---|---|---|
| `data-sound` | — | The file. |
| `data-sound-volume` | `1` | 0..1. |
| `data-sound-max` | — | Stop (with a short fade) after this many seconds. |
| `data-sound-start` | `0` | Start this many seconds into the file. |

To play something together with another step, give both the same `data-fragment-index`
(e.g. a guitar step `<span class="fragment" data-wiggle="edge" data-fragment-index="0">` and the sound's `data-fragment-index="0"`).

For a sound that goes with a graph's trace, use `data-audio` on the graph instead (see graph.md):
then the curve is drawn in step with the sound.

Browsers only play sound after the page has had a key press or click — the first "next" counts,
so it works while presenting; a sound on the very first slide of a freshly loaded page may stay silent.
