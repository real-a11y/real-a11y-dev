/**
 * Public entry. Consumers reference the package name in their
 * `.storybook/main.ts` `addons` array, and Storybook auto-loads the `./preview`
 * and `./manager` entrypoints. A CSF Next preview (`definePreview`) also calls
 * the default export below.
 *
 * This file exports the shared constants + types so tests and custom
 * tooling can decode the channel payload without re-declaring it.
 */
import type { PreviewAddon } from "storybook/internal/csf";

import { beforeAll } from "./preview.js";

export {
  ADDON_ID,
  PANEL_ID,
  EVENTS,
  type TreeMode,
  type TreeUpdatePayload,
} from "./constants.js";

/**
 * The addon's preview annotations, for a CSF Next `.storybook/preview.ts`:
 *
 * ```ts
 * import realA11y from "@real-a11y-dev/storybook-addon";
 *
 * export default definePreview({ addons: [realA11y()] });
 * ```
 *
 * A `definePreview` preview composes only the addons it names, so without this
 * the panel waits for a tree that never comes. The addon stays in `main.ts` as
 * well — that is what registers the panel.
 *
 * This is what Storybook's `definePreviewAddon` would return: that helper only
 * returns its argument, and `storybook@9.0` does not export it, so importing it
 * would break this barrel there. `PreviewAddon` is type-only and erased.
 */
export default function realA11y(): PreviewAddon {
  return { beforeAll };
}
