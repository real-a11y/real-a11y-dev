import { realmSingleton } from "@real-a11y-dev/core";

/**
 * The user's last "Show full names" choice from any panel's Settings, for the
 * life of the page, and the inspectors open on it, which all show it. It
 * outlives every panel: `refresh()` and `setRoot()` re-key the TreeView, and
 * the React wrapper makes a new inspector whenever one of its props changes,
 * and a new host whenever it remounts. One slot per realm (`realmSingleton`),
 * so every copy of this package loaded in the page shares the choice and the
 * panels.
 */
export interface FullNamesChoice {
  on?: boolean;
  /**
   * Each open inspector's render, run again when the choice changes. An
   * inspector joins each time it renders, and leaves on `unmount()`.
   */
  panels: Set<() => void>;
}

const FULL_NAMES_CHOICE_SHAPE = "full-names-choice@1";

export const fullNamesChoice = (): FullNamesChoice =>
  realmSingleton(
    "inspector.full-names-choice",
    FULL_NAMES_CHOICE_SHAPE,
    () => ({ panels: new Set() }),
  );

/**
 * Keep the user's choice for the page, and render every open panel with it:
 * all of them, even past one that throws. The error then surfaces: the one,
 * or an `AggregateError` of each.
 */
export function rememberShowFullNames(on: boolean): void {
  const choice = fullNamesChoice();
  choice.on = on;
  const failures: unknown[] = [];
  for (const rerender of choice.panels) {
    try {
      rerender();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(
      failures,
      "Panels failed to render the Show full names choice",
    );
  }
}
