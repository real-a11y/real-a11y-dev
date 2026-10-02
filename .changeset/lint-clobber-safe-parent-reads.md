---
---

No release. Tooling only: a `no-restricted-properties` rule now fails `pnpm lint` on a plain `parentElement`, `parentNode` or `assignedSlot` read in `core` or the extension, and its message points at the clobber-safe readers. The reads that remain in `core` are single reads on a node that can never be a `<form>`, and each carries a disable comment saying why; the live tree's `characterData` branch now reads its parent once instead of three times. No change to behavior — present only to satisfy the `changeset` CI gate on `packages/*/src/` edits.
