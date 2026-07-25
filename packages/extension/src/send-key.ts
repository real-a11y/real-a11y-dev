/**
 * SEND_KEY helpers for the content script.
 *
 * Chrome refuses default actions for untrusted (synthetic) KeyboardEvents:
 * an untrusted Tab does not move focus, and an untrusted Escape does not
 * close a native `<dialog>`. The panel's keyboard bar still needs those
 * behaviors, so after dispatching the synthetic events for page listeners
 * we apply the missing defaults ourselves — unless a page handler called
 * `preventDefault()` on keydown.
 *
 * Tab order comes from core's `getTabSequence` (same policy as the panel's
 * Tab Sequence view), resolved to live elements via the shared ElementRefMap.
 */

import {
  getTabSequence,
  type ElementRefMap,
  type ExtractionResult,
} from "@real-a11y-dev/core";

/** Payload shape mirrored from `PanelToContent` `SEND_KEY`. */
export type SendKeyPayload = {
  key: string;
  code: string;
  keyCode: number;
  modifiers?: {
    shift?: boolean;
    ctrl?: boolean;
    alt?: boolean;
    meta?: boolean;
  };
};

export type SendKeyOptions = {
  /**
   * Resolve the page's current tab sequence as live focusable elements.
   * Required for Tab / Shift+Tab; ignored for other keys.
   */
  resolveTabSequence: () => HTMLElement[];
};

/**
 * Map a core tab sequence onto live HTMLElements via the extractor's refs.
 * Shared by the content script and tests so Tab uses one ordering policy.
 */
export function elementsFromTabSequence(
  result: ExtractionResult,
  refs: ElementRefMap,
): HTMLElement[] {
  return getTabSequence(result)
    .map((n) => refs.get(n.id))
    .filter((el): el is HTMLElement => el instanceof HTMLElement);
}

function eventInit(payload: SendKeyPayload): KeyboardEventInit {
  return {
    key: payload.key,
    code: payload.code,
    keyCode: payload.keyCode,
    bubbles: true,
    cancelable: true,
    shiftKey: !!payload.modifiers?.shift,
    ctrlKey: !!payload.modifiers?.ctrl,
    altKey: !!payload.modifiers?.alt,
    metaKey: !!payload.modifiers?.meta,
  };
}

function ownerDocument(target: EventTarget): Document {
  if (target instanceof Document) return target;
  if (target instanceof Node) return target.ownerDocument ?? document;
  return document;
}

/**
 * Move focus to the next (or previous) element in `seq`. When focus is
 * inside an open `<dialog>`, the sequence is scoped to that dialog (focus
 * trap). Wraps at the ends so the keyboard bar stays useful on a single
 * page without leaving for browser chrome.
 */
export function moveFocusAlongTabSequence(
  doc: Document,
  direction: 1 | -1,
  seq: HTMLElement[],
): void {
  const active = doc.activeElement;
  const dialog =
    active instanceof Element ? active.closest("dialog[open]") : null;
  const scoped = dialog ? seq.filter((el) => dialog.contains(el)) : seq;
  if (scoped.length === 0) return;

  let idx = active instanceof HTMLElement ? scoped.indexOf(active) : -1;
  if (idx === -1 && active instanceof Element) {
    for (let i = 0; i < scoped.length; i++) {
      if (scoped[i].contains(active)) {
        idx = i;
        break;
      }
    }
  }

  const nextIdx =
    idx === -1
      ? direction === 1
        ? 0
        : scoped.length - 1
      : (idx + direction + scoped.length) % scoped.length;

  scoped[nextIdx].focus();
}

/**
 * Close a `<dialog>`. Prefer the native `.close()`; fall back to dropping
 * the `open` attribute (jsdom's `HTMLDialogElement` has no `.close()`).
 */
function closeDialog(el: Element): void {
  if (el instanceof HTMLDialogElement && typeof el.close === "function") {
    el.close();
    return;
  }
  el.removeAttribute("open");
}

/**
 * Close the open `<dialog>` that contains focus, or else the last open
 * dialog in document order. No-op when none are open.
 */
export function closeOpenDialog(doc: Document): void {
  const active = doc.activeElement;
  const containing =
    active instanceof Element ? active.closest("dialog[open]") : null;
  if (containing) {
    closeDialog(containing);
    return;
  }
  const open = doc.querySelectorAll("dialog[open]");
  const last = open[open.length - 1];
  if (last) closeDialog(last);
}

function applyNativeDefault(
  payload: SendKeyPayload,
  doc: Document,
  resolveTabSequence: () => HTMLElement[],
): void {
  if (payload.key === "Tab") {
    moveFocusAlongTabSequence(
      doc,
      payload.modifiers?.shift ? -1 : 1,
      resolveTabSequence(),
    );
    return;
  }
  if (payload.key === "Escape") {
    closeOpenDialog(doc);
  }
}

/**
 * Dispatch synthetic keydown/keyup on `target`, then apply native Tab /
 * Escape defaults Chrome skips for untrusted events. If a page listener
 * calls `preventDefault()` on keydown, the native fallback is skipped.
 */
export function sendKey(
  target: EventTarget,
  payload: SendKeyPayload,
  options: SendKeyOptions,
): void {
  const init = eventInit(payload);
  const allowed = target.dispatchEvent(new KeyboardEvent("keydown", init));
  if (allowed) {
    applyNativeDefault(
      payload,
      ownerDocument(target),
      options.resolveTabSequence,
    );
  }
  target.dispatchEvent(new KeyboardEvent("keyup", init));
}
