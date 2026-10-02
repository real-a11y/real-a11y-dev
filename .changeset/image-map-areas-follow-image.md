---
"@real-a11y-dev/testing": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Fix image map areas going missing from the tab sequence and the DOM tree. Since Chromium 153, which Playwright 1.63 installs, Chromium's UA stylesheet gives every `<area>` `display: none`, as jsdom's always has. The in-page walk skips anything `display: none`, so it dropped every area, although Chromium still tabs to one. On this page:

```html
<button>Before</button>
<img src="map.png" alt="Site map" usemap="#nav" />
<map name="nav"><area href="/home" alt="Home" coords="0,0,10,10" /></map>
<button>After</button>
```

`real-a11y tabs` printed, on Chromium 153:

```
01. button "Before"
02. button "After"
```

and now prints the stops Chromium tabs through, as it did on 151:

```
01. button "Before"
02. link "Home"
03. button "After"
```

An area now follows its image, the way Chromium decides it. Each rule was checked against Chromium 151 and 153 with a Tab walk, scripted `focus()` and Chromium's accessibility tree:

- **Rendered:** an area is in the tree while the first image whose `usemap` names its map is rendered: not `display: none` or `hidden`, itself or through an ancestor, and not `visibility: hidden` or `inert`. The area's own `display`, `hidden` and `visibility` don't count. An image inside a shadow root gives a map's areas nothing.
- **Order:** an area is a stop at its own place in the document, not at its image's.
- **Hidden map:** an area in a hidden or `inert` `<map>` stays out. Chromium tabs to one, but its accessibility tree leaves it out, and the walk follows the tree.
- **Accessibility:** an area whose image is `aria-hidden`, or which is `inert` itself, is hidden from AT, as Chromium's accessibility tree has it. Like an `aria-hidden` button, it then stays out of the a11y view and every tab list read from it, although Chromium tabs to it; the DOM view keeps it focusable. An area adds nothing to the name of the element its map sits in.
- **`tabindex`:** it makes an area focusable without an `href`, but only while an image uses its map, and a negative one leaves the area unfocusable even from script.

Where it shows:

- **`cli` / `mcp`:** `real-a11y tabs` and `get_tab_order` only. Every other view reads Chromium's own tree, which kept the areas.
- **Snapshots and assertions:** `tabSequenceSnapshot` and `toHaveTabSequence` list the areas again on Chromium 153, and for the first time in jsdom, whose stylesheet always hid them. Any area whose image isn't rendered stays out, on every version. A DOM-mode a11y snapshot gains a `link` per area. Re-record those baselines.
- **Panels:** the Tab Sequence view and the tree in `inspector`, `react` and `storybook-addon` show each area where its `<map>` sits, and drop or restore a map's areas when its image is hidden or shown.
