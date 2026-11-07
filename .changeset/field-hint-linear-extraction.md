---
"@real-a11y-dev/cli": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/mcp": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/testing": patch
---

Extract long forms in linear time. The DOM producer rescanned the whole page for every `aria-describedby` hint it folded and again for every field's `<label for>`, so a form with a hint under each field took about 30× longer when it grew 5×. It now indexes the `aria-describedby`, `aria-labelledby` and `label[for]` references of each tree once per extraction. Names, descriptions and which hints fold are unchanged, so saved snapshots do not churn.
