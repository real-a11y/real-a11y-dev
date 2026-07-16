---
"@real-a11y-dev/cli": patch
---

`real-a11y diff` output now reports **two clearly labeled axes** so the counts can't be misread. The markdown header was a single `0 new · 0 changed · 0 fixed · structure changed on 1 page` line — which made an all-clean findings count sitting next to a structure change read as a contradiction. It's now:

```
### Accessibility diff

**Findings** (gate CI): 0 new · 0 changed · 0 fixed — none changed
**Structure** (advisory): changed on 1 page — new or reordered headings, landmarks, or tab stops
```

_Findings_ are the accessibility problems that gate CI; _structure_ is the shape of the semantic tree (advisory, never gates) — so adding a valid new section moves the structure without introducing a single new finding. The terminal (`pretty`) summary is likewise labeled `findings:`.
