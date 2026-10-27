---
"@real-a11y-dev/storybook-addon": minor
---

Support CSF Next previews (`definePreview`), which Storybook 11 makes the default.

A `definePreview` preview composes only the addons it names in `addons`. Storybook's Vite builder does not even import the preview entry of an addon listed only in `main.ts`, so the panel sat on "Waiting for story to render…" on every story. The package root now exports `realA11y()` to name there:

```ts
// .storybook/preview.ts
import { realA11y } from "@real-a11y-dev/storybook-addon";
import { definePreview } from "@storybook/react-vite";

export default definePreview({
  addons: [realA11y()],
});
```

Keep the addon in `main.ts` too — that is what adds the panel. The namespace form `storybook add` writes, `import * as x from "@real-a11y-dev/storybook-addon/preview"` with `addons: [x]`, works as well. A classic `.storybook/preview.ts` needs no change.

`realA11y()` returns what Storybook's `definePreviewAddon` would. The addon does not call that helper, because `storybook@9.0` does not export it and importing it would break the package root there. It is a named export, not the default export Storybook's addon kit uses, because the package root also ships as CommonJS, where a default export's types and runtime shape disagree.

### Breaking change

The preview entry (`@real-a11y-dev/storybook-addon/preview`) no longer does anything when it is imported. It now exports a project-level `beforeAll` annotation that Storybook runs once when the preview starts, and whose cleanup it runs before a hot reload re-runs it. A side-effect import — `import "@real-a11y-dev/storybook-addon/preview"`, a workaround for the bug above — no longer starts the preview half of the addon. Replace it with `addons: [realA11y()]` in `definePreview`. Nothing else changes: a project that only lists the addon in `main.ts` keeps working as before.
