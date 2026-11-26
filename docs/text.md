# Text — a text block placed anywhere

File: `plugins/textPlugin.js` (plus `placeOnSlide` in `plugins/lib/revealHelpers.js`).

```html
<div class="text" data-x="0.25" data-y="0.15">
    <h2>The stars sing</h2>
    <p>and we can <em>listen</em></p>
</div>
```

Inside, write ordinary reveal.js content: `h1` … `h6`, `p`, lists, `<em>`, `<span class="fragment">`, ….
Size and font come from the theme, as everywhere else. The block leaves the slide's layout: it neither
pushes the other objects around nor gets pushed by them, and it is drawn on top of them.

| Attribute | Default | Meaning |
|---|---|---|
| `data-x`, `data-y` | `0.5`, `0.5` | Where the block goes: a fraction of the slide (0–1; x from the left, y from the top). |
| `data-anchor` | centre | Which point of the block goes to x, y: `top-left`, `top`, `top-right`, `left`, `right`, `bottom-left`, `bottom`, `bottom-right`. E.g. `data-anchor="left"` keeps the left edge in place when you edit the text. |
| `data-width` | its longest line | Wrap the text at this width (px). |
| `data-align` | `center` | Text alignment inside the block: `left`, `center`, `right`, `justify`. |

The whole block can be a fragment too: `<div class="text fragment" data-x="0.8" data-y="0.9">…</div>`.
Colors and other one-off styling: `style="color: var(--astro-accent)"` on the block or on a line.

`data-anchor` also works on the other objects that take `data-x` / `data-y` (stars, guitar, pendulum).

## A word that comes apart

```html
<div class="text word-split fragment" data-split-step>
    <h2><span data-note="&ldquo;stars&rdquo;">astero</span><span data-note="&ldquo;vibrations&rdquo;">seismo</span><span data-note="&ldquo;study of&rdquo;">logy</span></h2>
</div>
```

The parts (each `<span data-note="...">`, no spaces between them) first read as one word. On the press of
`data-split-step`, dots open up between the parts and each note fades in below its part. "Back" joins
the word again. The word grows from its centre, because the block is as wide as the slide unless you give
`data-width`. The word's size and font come from the `h1`/`h2`/… around it. The notes are in the body
font; their style is `.word-note` in `theme/astro.scss`.

| Attribute | Meaning |
|---|---|
| `data-split-step` | The press that splits it. A number places it like `data-fragment-index`. |
| `data-note` (on each part) | The text under that part (`*x*` is italic, `\nu` etc. become symbols). |
