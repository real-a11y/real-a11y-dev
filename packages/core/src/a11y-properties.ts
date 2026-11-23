/**
 * The one table of `a11y.properties` keys.
 *
 * `A11yInfo.properties` is an open `Record<string, string>`, so nothing stops
 * two producers from spelling a key two ways. This table is what both read:
 * the native transports to decide which Chromium accessibility properties to
 * keep and what to call them, serialize to say which producer carries a key,
 * and the testing adapter to turn a key back into its `aria-*` attribute.
 *
 * Keys are the ARIA attribute name without `aria-`, lowercase (`haspopup`,
 * `roledescription`), the convention `a11y.states` already follows. Values
 * are strings. `valuenow` and `valuetext` are not here on purpose: a value
 * has one home, `a11y.value`, where the sensitivity policy applies.
 */

/** Which tree producer writes a key today. */
export type A11yPropertyProducers = "both" | "dom" | "native";

/** One row of {@link A11Y_PROPERTIES}. */
export interface A11yPropertyInfo {
  /** The `a11y.properties` key. */
  readonly key: string;
  /** The ARIA attribute it comes from, or `null` for a key with no attribute. */
  readonly aria: string | null;
  /** The producers that write it today. */
  readonly producers: A11yPropertyProducers;
}

/** Every key `a11y.properties` carries, with the producers that write it. */
export const A11Y_PROPERTIES: readonly A11yPropertyInfo[] = [
  { key: "level", aria: "aria-level", producers: "both" },
  { key: "valuemin", aria: "aria-valuemin", producers: "native" },
  { key: "valuemax", aria: "aria-valuemax", producers: "native" },
  { key: "haspopup", aria: "aria-haspopup", producers: "native" },
  { key: "keyshortcuts", aria: "aria-keyshortcuts", producers: "native" },
  { key: "roledescription", aria: "aria-roledescription", producers: "native" },
  { key: "orientation", aria: "aria-orientation", producers: "native" },
  { key: "autocomplete", aria: "aria-autocomplete", producers: "native" },
  { key: "captions", aria: null, producers: "dom" },
];

/**
 * Chromium's accessibility property names that differ from the key, mapped to
 * it. Every other CDP name is already its key.
 */
export const CDP_PROPERTY_KEYS: Readonly<Record<string, string>> = {
  hasPopup: "haspopup",
};

const BY_KEY: ReadonlyMap<string, A11yPropertyInfo> = /* @__PURE__ */ new Map(
  A11Y_PROPERTIES.map((row) => [row.key, row]),
);

/** The row for a key, or `undefined` for a key the table doesn't list. */
export function a11yPropertyInfo(key: string): A11yPropertyInfo | undefined {
  return BY_KEY.get(key);
}

/**
 * The ARIA attribute a key was read from, or `null` when it has none
 * (`captions`) or the table doesn't list it.
 */
export function ariaAttributeOfProperty(key: string): string | null {
  return BY_KEY.get(key)?.aria ?? null;
}

/**
 * The `a11y.properties` key for a Chromium accessibility property name, or
 * `undefined` when that property is not one the native transports keep.
 * `valuenow` and `valuetext` are never kept.
 */
export function nativePropertyKey(cdpName: string): string | undefined {
  const key = CDP_PROPERTY_KEYS[cdpName] ?? cdpName;
  const row = BY_KEY.get(key);
  return row && row.producers !== "dom" ? key : undefined;
}
