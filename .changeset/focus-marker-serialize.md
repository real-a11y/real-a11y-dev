---
"@real-a11y-dev/serialize": minor
---

Mark the focused element in the tree, outline, and tab-order serializations with a trailing `[focused]`. This makes focus management — invisible in a plain tree dump — a one-line, committable assertion: "opening this dialog moved focus onto its heading", "this control is where focus lands after the click".

```
form "Sign-in form"
  textbox "Email" [focused]
  button "Sign in"
```

On by default (new `SerializeOptions.markFocus`, default `true`); pass `markFocus: false` for marker-free output. `serializeOutline` and `serializeTabSequence` now accept an options argument too. The marker is deterministic (same steps → same focus → same string) and appears **only when something inside the tree actually holds focus** — a fresh page (focus on `<body>`) serializes unchanged.

**Upgrading:** a committed snapshot captured _after_ an interaction that moved focus will gain a `[focused]` line the first time you run it on this version — the marker surfacing focus the snapshot was omitting. Review the diff and re-record once (`-u`). Snapshots of un-interacted UI are unaffected. To keep the old marker-free output, pass `markFocus: false`.
