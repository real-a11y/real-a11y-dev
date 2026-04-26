import { findAllByRole, getOutline, linearize } from "@real-a11y-dev/core";
import { extract } from "./extract.js";

/** Roles we consider intrinsically interactive for labeling checks. */
const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "searchbox",
  "combobox",
  "listbox",
  "checkbox",
  "radio",
  "slider",
  "spinbutton",
  "switch",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "tab",
]);

class A11yAssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "A11yAssertionError";
  }
}

/**
 * Every interactive node must have a non-empty accessible name.
 * Throws an {@link A11yAssertionError} listing the offenders.
 */
export function assertNoUnlabeledInteractive(root: Element): void {
  const tree = extract(root, "a11y");
  const offenders: string[] = [];
  for (const node of linearize(tree)) {
    if (!INTERACTIVE_ROLES.has(node.a11y.role)) continue;
    if (node.a11y.name.trim().length > 0) continue;
    offenders.push(`${node.a11y.role} (<${node.dom.tagName}>)`);
  }
  if (offenders.length) {
    throw new A11yAssertionError(
      `Found ${offenders.length} unlabeled interactive element(s):\n  - ${offenders.join("\n  - ")}`,
    );
  }
}

/**
 * Heading structure sanity check: exactly one `h1` and no skipped levels.
 */
export function assertHeadingOrder(root: Element): void {
  const tree = extract(root, "a11y");
  const outline = getOutline(tree);

  const h1s = outline.filter((e) => e.level === 1);
  if (h1s.length === 0) {
    throw new A11yAssertionError("Missing <h1>: every document should have exactly one top-level heading.");
  }
  if (h1s.length > 1) {
    throw new A11yAssertionError(
      `Expected exactly one <h1>, found ${h1s.length}: ${h1s.map((h) => `"${h.name}"`).join(", ")}`,
    );
  }

  let prev = 0;
  for (const entry of outline) {
    if (entry.level > prev + 1 && prev !== 0) {
      throw new A11yAssertionError(
        `Heading level skipped: "${entry.name}" is h${entry.level} but the previous heading was h${prev}.`,
      );
    }
    prev = entry.level;
  }
}

/**
 * Every dialog must have an accessible name (via `aria-label`, labelledby, or
 * a visible title child).
 */
export function assertDialogsLabeled(root: Element): void {
  const tree = extract(root, "a11y");
  const dialogs = [
    ...findAllByRole(tree, "dialog"),
    ...findAllByRole(tree, "alertdialog"),
  ];
  const unlabeled = dialogs.filter((d) => d.a11y.name.trim().length === 0);
  if (unlabeled.length) {
    throw new A11yAssertionError(
      `Found ${unlabeled.length} dialog(s) without an accessible name.`,
    );
  }
}

/**
 * Landmarks sanity: exactly one `main`, and `banner`/`contentinfo` appear at
 * most once at the top level.
 */
export function assertLandmarkStructure(root: Element): void {
  const tree = extract(root, "a11y");
  const mains = findAllByRole(tree, "main");
  if (mains.length === 0) {
    throw new A11yAssertionError("Missing <main>: every page needs a main landmark.");
  }
  if (mains.length > 1) {
    throw new A11yAssertionError(
      `Expected exactly one <main> landmark, found ${mains.length}.`,
    );
  }
  const banners = findAllByRole(tree, "banner");
  if (banners.length > 1) {
    throw new A11yAssertionError(
      `More than one top-level <header> (banner landmark): found ${banners.length}.`,
    );
  }
  const footers = findAllByRole(tree, "contentinfo");
  if (footers.length > 1) {
    throw new A11yAssertionError(
      `More than one top-level <footer> (contentinfo landmark): found ${footers.length}.`,
    );
  }
}

export { A11yAssertionError };
