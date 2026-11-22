import {
  isChoiceState,
  REDACTED_VALUE,
  type ActionRequest,
  type DomSemanticNode,
} from "@real-a11y-dev/core";

import type { DispatchReply, PanelToContent } from "../types.js";

import { describeAction, type FeedbackTarget } from "./action-feedback.js";

/** What {@link dispatchTabAction} needs of the panel. */
export interface TabActionPanel {
  /** Sends to the bound tab's content script: App's `sendToBoundTab`. */
  send: (message: PanelToContent, reply: (response: unknown) => void) => void;
  /** Shows a feedback line for `ms`: App's `announce`. */
  announce: (text: string, ms: number) => void;
  /** Reads the page again, once the action had a moment to change it. */
  reExtract: () => void;
}

/**
 * What a TAB row's feedback line reads of `node`: its role and states, and the
 * name the tab order shows it by, withheld where singling it out says which
 * choice a sensitive field holds (`a11y.choiceWithheld`), as a date grid's day
 * button does. Otherwise its name, or its tag when it has none.
 *
 * @internal
 */
export function tabRowTarget(node: DomSemanticNode): FeedbackTarget {
  return {
    role: node.a11y.role,
    name: node.a11y.choiceWithheld
      ? REDACTED_VALUE
      : node.a11y.name || node.dom.tagName,
    states: node.a11y.states,
  };
}

/**
 * Dispatch a TAB row's action through the content script, and say what it did
 * in the native tree's wording (`describeAction`). `target` is the row as it
 * was before the action.
 *
 * The line shows as the action is sent, except a choice item's (core's
 * `isChoiceState`): naming the item a user picked in a sensitive field's
 * popup says what the field holds (ADR-0001), and a TAB row can't tell such
 * an item from an ordinary one with no state. Only the page knows, so that
 * line waits for the content script's reply, which says
 * ({@link replyWithholdsChoice}).
 *
 * @internal
 */
export function dispatchTabAction(
  request: ActionRequest,
  target: FeedbackTarget,
  panel: TabActionPanel,
): void {
  const awaitsVerdict = isChoiceState("checked", target.role);
  const line = describeAction(target, request.action);
  if (line && !awaitsVerdict) panel.announce(line, 2000);

  panel.send({ type: "DISPATCH_ACTION", payload: request }, (response) => {
    const failure = actionFailure(response);
    // Replaces the optimistic line set above, whose own clear `announce`
    // cancels — otherwise that 2s timer wipes this 3s message a second early.
    if (failure) {
      panel.announce(`Failed: ${failure}`, 3000);
    } else if (awaitsVerdict) {
      const valueWithheld = replyWithholdsChoice(response);
      const verdict = describeAction(
        { ...target, valueWithheld },
        request.action,
      );
      if (verdict) panel.announce(verdict, 2000);
    }
    // Re-extract to reflect state change (checked, expanded, etc.)
    setTimeout(panel.reExtract, 100);
  });
}

/**
 * Why an action failed to land, or null. Two ways, and both have to be read:
 * the message never reached a content script (`lastError`), or one answered
 * and refused, which is how it reports that the action can't run (the element
 * gone since the page was read, say). Without the second, the optimistic line
 * stays on screen claiming something happened.
 */
function actionFailure(response: unknown): string | null | undefined {
  const refusal = response as { success?: boolean; error?: string } | undefined;
  return chrome.runtime.lastError
    ? chrome.runtime.lastError.message
    : refusal && refusal.success === false
      ? (refusal.error ?? "the page refused the action")
      : null;
}

/**
 * Whether the content script's reply says the item the action landed on sits
 * where the tree withholds a choice (`DispatchReply`). Fails closed: a reply
 * that doesn't say names no item.
 *
 * @internal
 */
export function replyWithholdsChoice(response: unknown): boolean {
  const reply = response as Partial<DispatchReply> | undefined;
  return reply?.choiceWithheld !== false;
}
