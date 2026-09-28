---
"@real-a11y-dev/testing": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Fix the tab sequence around rich-text editors. The DOM producer left out every `contenteditable` editor, although each one is a Tab stop, and it listed every link inside an editor, which Chromium won't focus at all. On a message composer, `real-a11y tabs` printed the reset link someone had pasted into the draft, token and all, and never mentioned the composer:

```
01. link "https://x.test/reset?token=abc123"
02. link "Mention Alice"
```

It now prints the stops Chromium actually tabs through:

```
01. textbox "Message"
02. link "Mention Alice"
03. generic
```

What counts as a stop, all checked against Chromium 151:

- **Editor:** the root of each editable region, its _editing host_, is a stop with no `tabindex` needed. `contenteditable` reads the way HTML defines it: `""`, `true` and `plaintext-only` in any case; `false` opts out; any other value inherits. A `contenteditable` nested inside an editor is part of it, not a second stop.
- **Link inside an editor:** not a stop, and not focusable at all, unless it has its own `tabindex` or sits in a `contenteditable="false"` island, like the mention chip above. Buttons, inputs and `tabindex` elements inside an editor stay stops.
- **Name:** an editor is named only by its author (`aria-label`, `aria-labelledby`, `title`), never by what was typed into it. That applies whatever its role, as in Chromium: `<h3 contenteditable>Draft</h3>` is an unnamed `heading`. A role-less `<div contenteditable>` used to be `generic "<its text>"` and is now `generic`. Its text still names another element that points at it with `aria-labelledby`.
- **Actions:** a role-less editor gets `focus` and `type` actions like a `textbox`. The panel can type into it, and the a11y view keeps it when it holds no text. A link inside an editor loses its `click` and `navigate` actions, because Chromium doesn't follow it, not even on a scripted `click()`. A `role="none"` link there now flattens away instead of staying as a bare `presentation` node.

Where it shows:

- **`cli` / `mcp`:** `real-a11y tabs` and `get_tab_order` only. Every other view reads Chromium's own tree and is unchanged.
- **Snapshots and assertions:** `tabSequenceSnapshot` and `toHaveTabSequence` gain each editor and lose links inside one. A DOM-mode a11y snapshot shows a role-less editor as `generic` instead of `generic "<its text>"`. Re-record those baselines.
- **`interaction` facet:** `isFocusable` is now `true` for an editor and `false` for a link inside one. A `role="presentation"` on either follows the same rule.
