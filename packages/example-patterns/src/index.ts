// APG-coverage components shared across the example apps.
//
// Each pattern ships TWO surfaces:
//   - `*Correct` — uses an off-the-shelf primitive (Radix, React Aria) so
//     the demo says "Real A11y audits whatever you ship, including the
//     libraries you actually use." No reinvention; tree-correct.
//   - `*Broken` — hand-rolled, deliberately missing or wrong on a single
//     ARIA / keyboard / focus axis so a Real A11y consumer can see
//     exactly which signal catches it (panel role chip, tree-diff,
//     audit-snapshot, IssuesBadge, etc.).
//
// Visually identical wherever practical; structurally different in the
// one detail the broken variant is illustrating.

export * from "./combobox/index.js";
export * from "./combobox-async/index.js";
export * from "./dialog/index.js";
export * from "./dialog-nested/index.js";
export * from "./disclosure/index.js";
export * from "./listbox/index.js";
export * from "./listbox-multi/index.js";
export * from "./menu/index.js";
export * from "./slider/index.js";
export * from "./tabs/index.js";
export * from "./toast/index.js";
export * from "./toolbar/index.js";
export * from "./tree-view/index.js";
export * from "./tree-checkable/index.js";
