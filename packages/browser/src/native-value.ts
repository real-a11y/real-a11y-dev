/**
 * The value a native tree's node announces (ADR-0001), split out of
 * `native-tree.ts`: Chromium's AX value, or a range widget's
 * `aria-valuetext`, finished by core's sensitivity policy. Pure functions
 * over a raw AX node and what the DOM walk recorded of it; no state.
 */

import {
  finishAnnouncedValue,
  isNativePasswordMask,
  nativeAXProperty,
  nonEmptyAXText,
  RANGE_VALUE_ROLES,
  STATE_ONLY_ROLES,
  type RawAXNameNode as RawAXNode,
} from "@real-a11y-dev/core";

import type { NativeDomInfo } from "./native-tree.js";

/**
 * The value a screen reader announces for `raw`, before sensitivity. Chromium's
 * AX `value` is the source: a text field's text, a `<select>`'s (and an ARIA
 * combobox's) selected text, a file input's names, a date input's value, an
 * editor's text. A range widget reads its `aria-valuetext` first (Chromium 151
 * does not report it over CDP, so it comes from the DOM walk), then Chromium's
 * `valuetext`, then its number. A checkbox or radio has none: its state says
 * it. The roles are core's, so both producers read the same kinds of field.
 */
function rawAnnouncedValue(
  raw: RawAXNode,
  role: string,
  enriched: NativeDomInfo | undefined,
): string | undefined {
  if (STATE_ONLY_ROLES.has(role)) return undefined;
  if (RANGE_VALUE_ROLES.has(role)) {
    return (
      nonEmptyAXText(enriched?.ariaValueText) ??
      nonEmptyAXText(nativeAXProperty(raw, "valuetext")?.value) ??
      nonEmptyAXText(raw.value?.value) ??
      nonEmptyAXText(nativeAXProperty(raw, "valuenow")?.value)
    );
  }
  return nonEmptyAXText(raw.value?.value);
}

/**
 * {@link rawAnnouncedValue}, finished by core's {@link finishAnnouncedValue} —
 * whitespace collapsed, capped at 240 characters with `…`, and
 * {@link REDACTED_VALUE} for a sensitive field that holds anything (or a value
 * that is Chromium's password mask). Empty reads as no value, so an agent can
 * tell "password entered" from "empty" but never the length.
 */
export function announcedValue(
  raw: RawAXNode,
  role: string,
  enriched: NativeDomInfo | undefined,
  sensitive: boolean,
): string | undefined {
  const text = rawAnnouncedValue(raw, role, enriched);
  return finishAnnouncedValue(
    text,
    () => sensitive || isNativePasswordMask(text),
  );
}
