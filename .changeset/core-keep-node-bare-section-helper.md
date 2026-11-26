---
---

Internal refactor, no behaviour change: the DOM producer's a11y filter checks whether an unnamed header/footer in sectioning content stays in the tree in a helper of its own, rather than inline in `keepNode`. It releases nowhere.
