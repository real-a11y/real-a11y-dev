/**
 * Split a Chromium accessibility node's `properties` into `a11y.states` and
 * `a11y.properties`.
 *
 * One copy for every native transport (`browser`'s producer, the extension's
 * debugger mode), which each kept an identical one until now. The property
 * keys come from the table in `../a11y-properties.ts`; the state names are
 * listed here.
 *
 * Field values are never read here. `valuenow` and `valuetext` are not in the
 * table: for a range widget they ARE its value, and a value has one home,
 * `a11y.value`, where the sensitivity policy and `redactInput` apply. Chromium
 * cannot be trusted to have redacted a sensitive field in its own payload (it
 * masks passwords, not a `cc-number` on a plain text input). `valuemin` and
 * `valuemax` are authored bounds, not user data, so they stay.
 */

import { nativePropertyKey } from "../a11y-properties.js";
import type { A11yInfo } from "../types.js";

import { nativeAXStateValue } from "./ax-vocabulary.js";

/**
 * AX property names that map to boolean/stateful `a11y.states`.
 *
 * The shared ARIA-derived keys (`checked`, `expanded`, `pressed`, `selected`,
 * `disabled`, `required`, `invalid`) match what the DOM producer writes, so
 * those compare cleanly across producers. Native additionally exposes
 * Blink-computed state Chromium has but the in-page walk doesn't (`focusable`,
 * `focused`, `editable`, `settable`, `multiline`, `modal`, `busy`), a superset
 * and not a conflict.
 */
export const NATIVE_AX_STATE_PROPERTIES: ReadonlySet<string> = new Set([
  "focusable",
  "focused",
  "editable",
  "settable",
  "checked",
  "expanded",
  "pressed",
  "selected",
  "disabled",
  "readonly",
  "required",
  "multiline",
  "invalid",
  "modal",
  "busy",
]);

/** The part of a CDP `Accessibility.AXNode` this reads. */
export interface RawNativeAXFacetNode {
  role?: { value?: string };
  properties?: Array<{
    name: string;
    value?: { type?: string; value?: unknown };
  }>;
}

/**
 * The states and properties of one native node.
 *
 * - A `listitem`'s `level` is dropped: Chromium computes it from nesting, no
 *   author set it, and neither producer reports one (only headings and the
 *   roles whose level Core-AAM requires computed carry a level).
 * - A property is written under its key (Chromium's `hasPopup` is `haspopup`).
 * - An empty or whitespace-only `roledescription` is dropped. WAI-ARIA 1.2
 *   says user agents MUST NOT expose one, and Chromium passes `"  "` through.
 *
 * @internal Shared between `core` and the native transports.
 */
export function nativeAXFacets(
  raw: RawNativeAXFacetNode,
): Pick<A11yInfo, "states" | "properties"> {
  const states: A11yInfo["states"] = {};
  const properties: A11yInfo["properties"] = {};
  for (const p of raw.properties ?? []) {
    const v = p.value?.value;
    if (v === undefined || v === null || typeof v === "object") continue;
    if (p.name === "level" && raw.role?.value === "listitem") continue;
    if (NATIVE_AX_STATE_PROPERTIES.has(p.name)) {
      states[p.name] = nativeAXStateValue(p.value!);
      continue;
    }
    const key = nativePropertyKey(p.name);
    if (key === undefined) continue;
    const text = String(v);
    if (key === "roledescription" && text.trim() === "") continue;
    properties[key] = text;
  }
  return { states, properties };
}
