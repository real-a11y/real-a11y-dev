---
"@real-a11y-dev/testing": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Read CSS generated content and `text-transform` into the names the DOM producer computes from content. A button that reads "before label after" on screen was named `label`, and an uppercase heading kept its source casing, so a jsdom or in-page name differed from the one Chromium exposes to assistive technology. accname 1.2 step 2F says `::before` content is prepended and `::after` content appended without a space:

```html
<style>
  .x::before {
    content: "before ";
  }
  .alt::before {
    content: "★" / "Favourite ";
  }
</style>
<button class="x">label</button>
<button class="alt">item</button>
<h2 style="text-transform: uppercase">Call us</h2>
```

```
before: button "label"           button "item"             heading "Call us"
after:  button "before label"     button "Favourite item"   heading "CALL US"
```

- **Generated content** counts for the host, its descendants, `aria-labelledby` targets and label elements. Strings and `attr()` count; `counter()`, `url()` and quote marks add nothing, and in the alternative-text form `X / Y` only `Y` counts. Inline generated text joins with no space; a pseudo-element laid out as a box (`inline-block`, `block`) is spaced like any box, as in Chromium.
- **`text-transform`** `uppercase`, `lowercase` and `capitalize` apply to the text they transform.
- **Under jsdom** generated content still contributes nothing, because jsdom does not implement pseudo-element styles; `text-transform` applies there too.
- **Snapshots:** a saved snapshot, diff or baseline recorded from a page that uses either will churn, and needs re-recording.
- **`cli` / `mcp`:** only the tab order from `real-a11y tabs` and `get_tab_order` is built with the DOM producer. Everything else they print reads Chromium's own tree, which already included both.
