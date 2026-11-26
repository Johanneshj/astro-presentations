# Writing a new plugin

All plugins follow the same pattern, so a new one is mostly copy-and-adapt. Start from
`plugins/pendulumPlugin.js` (small) and `plugins/pendulum.js`.

## 1. The drawing module: `createThing(container, options)`

- Merge `options` over a defaults object; warn about unknown option names (catches typos).
- Create a canvas, sized `width × height` in CSS pixels, rendered at
  `pixelRatio(renderScale, width, height)` (sharp at any slide scale).
- Animation loop with `requestAnimationFrame`; only redraw when something changes.
- Return a handle: `{ start, stop, set(newOptions), dispose, ...your own methods }`.

## 2. The plugin: `ThingPlugin = { id, init(deck) }`

Helpers in `plugins/lib/revealHelpers.js`:

| Helper | What it does |
|---|---|
| `readOptions(el, ATTRIBUTES)` | data-attributes → options. `ATTRIBUTES` maps `camelCasedAttribute: [optionName, converter]`; converters: `Number`, `String`, `bool`, `numberList`, `stringList`. `data-size` sets width and height. |
| `reserveSize(el, w, h)` | Give the element its final size at once (it is created lazily). |
| `triggerFor(el, 'swingStep')` | If the element has `data-swing-step`, insert an invisible fragment after it: one press of "next". Returns it (or null). |
| `isShown(trigger)` | Has that press happened? |
| `manageSlideItems(deck, '.thing', hooks)` | Creates handles when their slide is first shown, stops them on hidden slides, disposes old ones (at most `maxLive`), follows reveal's scale, handles `?print-pdf`. Hooks: `create(item)`, `onShow(item, isNew)`, `onHide(item)`, `onPrint(item)`, `prepare(item)` (neighbouring slides, e.g. preload). |
| `formatLabel`, `replaceSymbols` | `*x*` → italic, `\nu` → ν. |

The rule that keeps "back" working: **derive the state only from which triggers are shown**
(`isShown`), both when a slide is entered (`onShow`) and on `fragmentshown` / `fragmenthidden`.
Never count presses.

## 3. Register it

In `index.html`: `import { ThingPlugin } from './plugins/thingPlugin.js';` and add it to `plugins: [...]`.
Add a page in `docs/` and a line in the README table.
