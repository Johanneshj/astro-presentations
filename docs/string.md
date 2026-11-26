# String (`plugins/stringPlugin.js`, `plugins/string.js`)

A standing wave on a string, held between two vertical posts. The string swings as
y = A sin(n π u) cos(2π · rate · t) (u = 0 … 1 along the string), so it has n half wavelengths between
the posts and n − 1 nodes in between, which never move.

```html
<div class="string" data-mode="2" data-rate="1"></div>
<div class="string fragment" data-mode="3" data-rate="1.5" data-x="0.8" data-y="0.7" data-label="330 Hz"></div>
```

It moves as soon as its slide shows (a fragment string is already moving while it fades in). For real
harmonics, give the modes rates in the same ratio as their numbers (mode 1, 2, 3 at rates 0.5, 1, 1.5),
the way the peaks in a spectrum sit at 1, 2, 3 times the fundamental. The A-string spectrum slide in
index.html does this: on the last press the spectrum moves aside (`data-move-*`, docs/move.md) and three
strings fade in next to it.

| Attribute | Default | Meaning |
|---|---|---|
| `data-mode` | `1` | n: 1 = the fundamental, 2 = one node in the middle, … |
| `data-rate` | `1` | Oscillations per second. |
| `data-width`, `data-height` | `360`, `120` | Size in slide pixels (the label goes inside it). |
| `data-x`, `data-y`, `data-anchor` | | Free placement on the slide, as for the stars. |
| `data-amplitude` | `0.8` | How far it swings, as a fraction of the room to the posts' ends. |
| `data-color` | `#72d7e9` | The string (the graphs' colour). |
| `data-line-width` | `3` | Thickness of the string. |
| `data-post-color`, `data-post-width`, `data-post-height` | white, `4`, `0.9` | The posts (height: fraction of the room). |
| `data-envelope`, `data-envelope-color` | on, faint white | Dashed outline of the extreme shapes. `data-envelope="false"` hides it. |
| `data-nodes`, `data-node-color` | on, white | Dots at the nodes (the ends included). |
| `data-label`, `data-label-color`, `data-font-size` | none, white, `20` | Text below the string; `*…*` is italic, `\name` a symbol. |
