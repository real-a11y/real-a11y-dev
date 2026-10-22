---
"@real-a11y-dev/testing": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Name links, buttons and headings from what their children say about themselves, the way Chromium does. When an element was named from its content, the DOM producer read only its children's text, so an image's `alt`, a child's `aria-label` and an SVG's `<title>` never reached the name:

| Markup                                                                | Before                  | Now                    |
| --------------------------------------------------------------------- | ----------------------- | ---------------------- |
| `<a href="/"><img alt="Home"></a>`                                    | `link`                  | `link "Home"`          |
| `<button><span aria-label="Close">×</span></button>`                  | `button "×"`            | `button "Close"`       |
| `<a href="/kb"><img alt="Help"> center</a>`                           | `link "center"`         | `link "Help center"`   |
| `<button><span role="img">★</span> Favourite</button>`                | `button "★ Favourite"`  | `button "Favourite"`   |
| `<textarea placeholder="Your reply"></textarea>`                      | `textbox`               | `textbox "Your reply"` |
| `<button aria-label=" ">Save</button>`                                | `button`                | `button "Save"`        |
| `<h2><input type="checkbox" id="c"><label for="c">Agree</label></h2>` | `heading "Agree Agree"` | `heading "Agree"`      |

Each child now lends its own text alternative before its content, as accname §2F.iii and Chromium's own tree do:

- **An image** lends its `alt`, an `<svg>` its first `<title>`, and either one its `title` when it has nothing else, never its content. `<svg><text>Go</text></svg>` inside a button lends nothing, as in Chromium. An empty `alt`, `aria-hidden` and `role="presentation"` still lend nothing.
- **Any child** lends its `aria-label`, and its `aria-labelledby` unless it sits inside another reference.
- **`aria-labelledby` and `aria-describedby`** borrow the referenced element's own `aria-label` or `alt` before its content, and images inside it lend their `alt`.
- **A `<label>`** that holds an image names its field from the image's `alt`.
- Text an attribute lends is spaced off even inline: `<a><img alt="Help">center</a>` is "Help center", and a link named by `aria-label` inside a heading is spaced the same way.
- An `<svg>` with a `<title>` is named by it, an `<input type="image">` by its `alt` (after a label), and a `<textarea>` falls back to its `placeholder` as an `<input>` does.
- A `<select>`'s options are still named by their text alone.
- A blank `aria-label`, only spaces, is skipped as if absent, on the element and on a child, so the name falls through to the next source.
- Each element counts once in a name, as in Chromium. An icon labelled by the text beside it, `<a href="/"><svg aria-labelledby="t"></svg><span id="t">Docs</span></a>`, is "Docs", not "Docs Docs", and a heading that holds a checkbox and its label reads the label once. Each IDREF of an `aria-labelledby` still reads its whole target, so two overlapping targets repeat what they share, as they do in Chromium.

What this changes for you:

- **Assertions and audits:** `assertNoUnlabeledInteractive` and the unlabeled-control findings stop flagging logo links and icon buttons whose image has an `alt`, and `image-alt` stops reporting an `<svg>` its `<title>` names. A button whose only content is an unlabelled `role="img"` glyph, or SVG `<text>`, is now unnamed and flagged, as it is in Chromium.
- **Queries:** `findByRole("link", { name: "Home" })` now finds `<a href="/"><img alt="Home"></a>`.
- **Snapshots and diffs:** the names of links, buttons, headings, cells and labelled fields that hold images, labelled children or SVG titles change. Re-record those snapshots.
- **Panels:** `inspector`, `react` and `storybook-addon` show the new names.
- **`cli` / `mcp`:** only `real-a11y tabs` and `get_tab_order` change, because only they read the in-page tree. Everything else they print comes from Chromium's own tree, which already named these.
