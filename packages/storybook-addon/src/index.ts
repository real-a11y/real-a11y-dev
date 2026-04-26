/**
 * Public entry — consumers generally don't import from this barrel; they
 * reference the package name in their `.storybook/main.ts` `addons` array,
 * and Storybook auto-loads the `./preview` and `./manager` entrypoints.
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
