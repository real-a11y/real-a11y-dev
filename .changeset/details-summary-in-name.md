---
"@real-a11y-dev/testing": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

A heading, button or link that contains a `<details>` now includes the disclosure's summary in its accessible name, the way Chromium does.

The DOM extractor treated `<details>` like any other `group` and skipped everything inside it when naming an ancestor. So a GitHub comment header, `user commented • <details><summary>edited by bot</summary>…</details>`, was named "user commented •", while Chromium (and a screen reader) reads "user commented • edited by bot". Now:

- **A closed `<details>`** contributes its summary (the first `<summary>`) and nothing else, because the rest is hidden until it opens.
- **An open `<details>`** contributes all of its content.
- **An explicit `role="group"`** on the `<details>` still blocks it, as it does in Chromium.
- **A closed `<details role="none">`** no longer leaks its hidden body into the name. It used to, with the words glued together ("SBody").

Live views (the inspector, the React and Storybook panels, the extension) keep that name current. Editing the summary, or opening and closing the `<details>`, now updates the enclosing heading or button without a full refresh.

Descriptions built from `aria-describedby` are now whitespace-collapsed like names, so a description no longer carries a doubled space where the walk padded a link or summary.

**Expect snapshot changes** where a named element contains a `<details>`: its name gains the summary text.

One remaining difference: a `<details>` with no `<summary>` gets its name from Chromium's built-in, localized "Details" label. That label isn't reproduced here.
