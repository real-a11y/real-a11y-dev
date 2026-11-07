---
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
"@real-a11y-dev/testing": patch
---

Read a long list through the native producer in linear time. Locators were computed for every element by rescanning its parent's children, so a container with k children cost O(k²): a 10,000-item list spent about 5.9 s on locators on top of Chromium's own read. The native read now records each element's position among its same-tag siblings once, in the walk it already makes, and builds every locator from that record.

Output is unchanged: every locator, and so every fingerprint, baseline, SARIF, JUnit and markdown report, is byte-identical.
