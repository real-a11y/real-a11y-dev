---
"@real-a11y-dev/storybook-addon": patch
---

Stop installing `@real-a11y-dev/testing` with the Storybook addon. The addon listed it as a runtime dependency, so `npm i -D @real-a11y-dev/storybook-addon` also downloaded `testing` (about 4 MB unpacked), but the addon never imports it: the preview extracts, observes and acts on the tree with the engine it bundles. The addon's built files are byte-for-byte the same; only its `package.json` loses the dependency. If your own stories or tests import `@real-a11y-dev/testing` and only worked because the addon installed it, add it to your project directly (`npm i -D @real-a11y-dev/testing`).
