# Props — simple drawings placed anywhere

File: `plugins/propsPlugin.js`. Flat drawings, no animation; add more in `PROPS` at the top of the file.

```html
<div class="microphone fragment"   data-x="0.32" data-y="0.58" data-height="340"></div>
<div class="clapperboard fragment" data-x="0.66" data-y="0.6"  data-height="320" data-open="12"></div>
```

| Attribute | Default | Meaning |
|---|---|---|
| `data-x`, `data-y` | `0.5`, `0.5` | Where its centre goes: a fraction of the slide (0–1; x from the left, y from the top). It leaves the slide's layout, so it moves nothing else. |
| `data-anchor` | centre | Which point of it goes to x, y: `top-left`, `bottom`, `right`, … |
| `data-height` | `340` (microphone), `320` (clapperboard) | Height in slide px; the width follows. |
| `data-open` | `12` | Clapperboard: how far the top bar is open, in degrees (0 = shut). |

`class="fragment"` makes it appear on a press (any reveal fragment style, e.g. `fragment fade-up`).

| Prop | Looks like |
|---|---|
| `microphone` | A handheld stage microphone: round grille with a band, black handle. |
| `clapperboard` | A film clapperboard, no writing. |
