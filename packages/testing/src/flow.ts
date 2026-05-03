import type { ActionType, SemanticNode } from "@real-a11y-dev/core";
import { findByRole, type FindByRoleOptions } from "@real-a11y-dev/core";

import { dispatch } from "./dispatch.js";
import { extract } from "./extract.js";
import { serializeTree } from "./serialize.js";
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
      const result = await dispatch(this.current, action, payload);
      if (!result.success) {
        throw new Error(
          `flow.${action}: dispatch failed on ${this.current.a11y.role} "${this.current.a11y.name}": ${result.error ?? "unknown error"}`,
        );
      }
      await waitForMutations(this.root, {
        timeout: this.options.waitTimeout ?? 200,
      });
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
