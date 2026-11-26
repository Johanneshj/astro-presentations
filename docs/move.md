# Move — slide objects to a new place on a press

File: `plugins/movePlugin.js`. Works on everything placed with `data-x` / `data-y`: stars, pulsating
stars, text blocks, props, the guitar, the pendulum.

```html
<div class="stellar" data-radius="160" data-x="0.25" data-y="0.3"
     data-move-step data-move-x="0.13" data-move-y="0.27" data-move-scale="0.55"></div>
```

| Attribute | Default | Meaning |
|---|---|---|
| `data-move-step` | — | The press that moves it. Everything on a slide with the same value moves on the same press. A number places the step like `data-fragment-index`; with no number the step comes after the slide's other steps. |
| `data-move-x`, `data-move-y` | stays | Where it goes, as a fraction of the slide (like `data-x` / `data-y`). |
| `data-move-scale` | `1` | Its size there (0.5 = half). A star scales about its centre, and its name keeps its size. |
| `data-move-duration` | `1.2` | Seconds. |

"Back" moves it back again. Arriving on the slide from elsewhere, it is already in the right place
(no gliding).

Example, the four-star slide: the stars open, close, then move aside (`data-move-step="2"`) while
`<div class="text word-split fragment" data-fragment-index="2">` fades in at the same time, and the word
splits on the next press (`data-split-step="3"`). When a slide mixes several kinds of steps, give
them all numbers (`data-stellar-open="0" data-stellar-close="1"` …) to fix the order.
