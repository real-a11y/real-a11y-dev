import type { ActionType, SemanticNode, TreeDiff } from "@real-a11y-dev/core";
import {
  diffTrees,
  findByRole,
  type FindByRoleOptions,
} from "@real-a11y-dev/core";

import {
  extract,
  serializeTree,
  serializeTreeDiff,
} from "@real-a11y-dev/serialize";

import { capture, type A11yCapture } from "./capture.js";
import { checkChangeSpec, type ChangeSpec } from "./change-spec.js";
import { dispatch } from "./dispatch.js";
import { waitForMutations } from "./wait.js";

export interface FlowOptions {
  /**
   * ms to wait for mutations after each action. Default 200 — long enough
   * for synchronous state changes and React/Preact flushes, short enough
   * to keep tests snappy.
   */
  waitTimeout?: number;
}

/**
 * Fluent interaction-flow builder.
 *
 * ```ts
 * await flow(root)
 *   .findByRole("combobox", { name: /country/i })
 *   .click()
 *   .findByRole("option", { name: "Spain" })
 *   .click()
 *   .expectTree(/* snapshot *\/);
 * ```
 *
 * Under the hood: each step queues a task that (1) re-extracts the tree, (2)
 * runs the action, (3) awaits a debounced mutation. The whole chain is a
 * thenable, so you can `await` it directly.
 */
export function flow(root: Element, options: FlowOptions = {}): FlowChain {
  return new FlowChain(root, options);
}

type Step = () => Promise<void>;

export class FlowChain implements PromiseLike<void> {
  private readonly steps: Step[] = [];
  private current: SemanticNode | null = null;
  /**
   * The tree captured just before the FIRST action of the current diff window.
   * `action()` sets it (once); `expectChanges` diffs against it and resets it,
   * opening a fresh window for the next action.
   */
  private baseline: A11yCapture | null = null;

  constructor(
    private readonly root: Element,
    private readonly options: FlowOptions,
  ) {}

  /** Select a node by role. Subsequent actions target this node until another find. */
  findByRole(role: string, options: FindByRoleOptions = {}): this {
    this.steps.push(async () => {
      const tree = extract(this.root, "a11y");
      const node = findByRole(tree, role, options);
      if (!node) {
        throw new Error(
          `flow.findByRole: no node with role "${role}"${
            options.name ? ` and name ${String(options.name)}` : ""
          } found in document.`,
        );
      }
      this.current = node;
    });
    return this;
  }

  private action(action: ActionType, payload?: Record<string, unknown>): this {
    this.steps.push(async () => {
      if (!this.current) {
        throw new Error(
          `flow: cannot ${action}() — call findByRole() first to select a node.`,
        );
      }
      // Open the diff window at the first action after chain start / the last
      // expectChanges — captured BEFORE dispatch, so a preceding findByRole
      // never pollutes it.
      this.baseline ??= capture(this.root);

      // Start observing BEFORE dispatching. `ActionDispatcher.dispatch` is
      // fully synchronous — a handler's DOM writes (and the input/change
      // events from `type()`) land *while* dispatch runs. An observer created
      // afterwards never sees them, so the wait could only ever end at the
      // timeout: every step paid the full `waitTimeout` as dead wait, giving a
      // 10-step chain a hard 2s floor. `waitForMutations` starts its
      // DomObserver synchronously, so holding the promise here means the
      // observer is live before the first event fires, and the step resolves
      // one debounce after the action instead.
      const settled = waitForMutations(this.root, {
        timeout: this.options.waitTimeout ?? 200,
      });

      const result = await dispatch(this.current, action, payload);
      if (!result.success) {
        // Don't make the failure path wait the timeout out. The pending
        // observer stops itself when its own timer fires.
        void settled;
        throw new Error(
          `flow.${action}: dispatch failed on ${this.current.a11y.role} "${this.current.a11y.name}": ${result.error ?? "unknown error"}`,
        );
      }
      await settled;
    });
    return this;
  }

  /** Click the current node. */
  click(): this {
    return this.action("click");
  }

  /** Submit the current node (form). */
  submit(): this {
    return this.action("submit");
  }

  /** Toggle the current node (details, aria-expanded). */
  toggle(): this {
    return this.action("toggle");
  }

  /** Select an option on the current node (combobox, listbox). */
  select(value: string): this {
    return this.action("select", { value });
  }

  /** Type text into the current node. */
  type(text: string): this {
    return this.action("type", { value: text });
  }

  /** Assert the tree serialization equals the expected snapshot. */
  expectTree(expected: string): this {
    this.steps.push(async () => {
      const actual = serializeTree(this.root);
      if (actual.trim() !== expected.trim()) {
        throw new Error(
          `flow.expectTree: tree does not match expected snapshot.\n--- expected\n${expected}\n--- actual\n${actual}`,
        );
      }
    });
    return this;
  }

  /**
   * Assert what the interaction(s) since the diff window opened changed in the
   * tree — the differentiator over element-querying. The window is everything
   * since the chain's first action (or the previous `expectChanges`), and it
   * resets afterward so a later `expectChanges` covers only the next steps.
   *
   * Three forms:
   * - **`ChangeSpec`** (the ergonomic default) — subset-matched by role/name;
   *   `exact: true` asserts nothing else changed:
   *   ```ts
   *   .expectChanges({
   *     added: [{ role: "option", name: "Spain" }],
   *     changed: [{ role: "combobox", changes: ["a11y.states.expanded"] }],
   *   })
   *   ```
   * - **`string`** — trim-compared against the `serializeTreeDiff` output
   *   (mirrors `expectTree`; includes the `focus:` line).
   * - **predicate** — `(diff) => void`, the escape hatch (throw to fail).
   *
   * Throws if no action has run yet. A `ChangeSpec`/`string` failure ends with
   * the full rendered diff, so "what DID change?" is always answered.
   */
  expectChanges(
    expected: string | ChangeSpec | ((diff: TreeDiff) => void),
  ): this {
    this.steps.push(async () => {
      if (!this.baseline) {
        throw new Error(
          "flow.expectChanges: no action has run — nothing to diff.",
        );
      }
      const now = capture(this.root);
      const diff = diffTrees(this.baseline.tree, now.tree);
      const render = () =>
        serializeTreeDiff(diff, {
          focusBefore: this.baseline?.focus,
          focusAfter: now.focus,
        });

      if (typeof expected === "string") {
        const actual = render();
        if (actual.trim() !== expected.trim()) {
          throw new Error(
            `flow.expectChanges: diff does not match expected.\n--- expected\n${expected}\n--- actual\n${actual}`,
          );
        }
      } else if (typeof expected === "function") {
        expected(diff);
      } else {
        const problems = checkChangeSpec(diff, expected);
        if (problems.length) {
          throw new Error(
            `flow.expectChanges:\n  ${problems.join("\n  ")}\n--- actual diff\n${render()}`,
          );
        }
      }

      this.baseline = null; // close the window; next action opens a fresh one
    });
    return this;
  }

  /**
   * Assert that the first `role="dialog"` or `role="alertdialog"` in the
   * tree matches the predicate (pass `null` to assert none is open).
   */
  expectActiveModal(predicate: null | ((name: string) => boolean)): this {
    this.steps.push(async () => {
      const tree = extract(this.root, "a11y");
      const dialog =
        findByRole(tree, "dialog") ?? findByRole(tree, "alertdialog");
      if (predicate === null) {
        if (dialog)
          throw new Error(
            `flow.expectActiveModal(null): unexpected open dialog "${dialog.a11y.name}".`,
          );
        return;
      }
      if (!dialog) throw new Error("flow.expectActiveModal: no open dialog.");
      if (!predicate(dialog.a11y.name)) {
        throw new Error(
          `flow.expectActiveModal: dialog name "${dialog.a11y.name}" did not satisfy predicate.`,
        );
      }
    });
    return this;
  }

  /** Run an arbitrary assertion against the live tree. */
  expect(
    predicate: (tree: ReturnType<typeof extract>) => void | Promise<void>,
  ): this {
    this.steps.push(async () => {
      const tree = extract(this.root, "a11y");
      await predicate(tree);
    });
    return this;
  }

  private async run(): Promise<void> {
    for (const step of this.steps) await step();
  }

  then<TResult1 = void, TResult2 = never>(
    onfulfilled?: ((value: void) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.run().then(onfulfilled, onrejected);
  }
}
