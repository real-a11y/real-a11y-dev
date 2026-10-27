/**
 * Public entry. Consumers reference the package name in their
 * `.storybook/main.ts` `addons` array, and Storybook auto-loads the `./preview`
 * and `./manager` entrypoints. A CSF Next preview (`definePreview`) also calls
 * the default export below.
 *
 * This file exports the shared constants + types so tests and custom
 * tooling can decode the channel payload without re-declaring it.
 */
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
 * This is what Storybook's `definePreviewAddon` would return — that helper only
 * returns its argument — written without it: `storybook@9.0` exports neither
 * the helper nor its `PreviewAddon` type, so naming either would break this
 * barrel there. The return type is structural and satisfies `PreviewAddon`.
 *
 * The preview entry loads on first use rather than as an import: this barrel
 * is also where manager-side tooling gets `EVENTS`, and a static import would
 * pull core and `storybook/preview-api` into the manager with it.
 */
export default function realA11y(): RealA11yPreviewAnnotations {
  return {
    beforeAll: async () => (await import("./preview.js")).beforeAll(),
  };
}

/** The project annotations {@link realA11y} hands a CSF Next preview. */
export interface RealA11yPreviewAnnotations {
  /** Wires the story iframe to the panel; resolves to its cleanup. */
  beforeAll: () => Promise<(() => void) | undefined>;
}
