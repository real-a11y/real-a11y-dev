/**
 * SEND_KEY helpers for the content script.
 *
 * Chrome refuses default actions for untrusted (synthetic) KeyboardEvents:
 * an untrusted Tab does not move focus, and an untrusted Escape does not
 * close a native `<dialog>`. The panel's keyboard bar still needs those
 * behaviors, so after dispatching the synthetic events for page listeners
 * we apply the missing defaults ourselves — unless a page handler called
 * `preventDefault()` on keydown.
 */

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

const TABBABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  'input:not([disabled]):not([type="hidden"])',
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[contenteditable="plaintext-only"]',
  "[tabindex]",
].join(",");

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
 * Is `el` (or an ancestor) hidden from sequential focus navigation?
 * Attribute / inline-style checks only — jsdom has no layout, and the
 * content script's tab walk does not need computed styles for the common
 * `hidden` / `aria-hidden` / `display:none` cases.
 */
function isHiddenFromTab(el: Element): boolean {
  let node: Element | null = el;
  while (node && node !== node.ownerDocument?.documentElement) {
    if (node.hasAttribute("hidden")) return true;
    if (node.getAttribute("aria-hidden") === "true") return true;
    if (node instanceof HTMLElement && "inert" in node && node.inert) {
      return true;
    }
    if (node instanceof HTMLElement) {
      const { display, visibility } = node.style;
      if (display === "none" || visibility === "hidden") return true;
    }
    node = node.parentElement;
  }
  return false;
}

/**
 * Document (or dialog) tab sequence: positive `tabindex` ascending, then
 * naturally focusable / `tabindex=0` in DOM order. Excludes `tabindex=-1`,
 * disabled controls, and hidden subtrees. Approximation of sequential focus
 * navigation — good enough for the panel keyboard bar.
 */
export function collectTabSequence(root: ParentNode): HTMLElement[] {
  const candidates = Array.from(
    root.querySelectorAll(TABBABLE_SELECTOR),
  ) as HTMLElement[];

  const entries: Array<{ el: HTMLElement; tabindex: number; order: number }> =
    [];
  let order = 0;

  for (const el of candidates) {
    const i = order++;
    if (isHiddenFromTab(el)) continue;
    if ((el as HTMLInputElement).disabled) continue;

    const raw = el.getAttribute("tabindex");
    let tabindex = 0;
    if (raw !== null) {
      const n = Number(raw);
      if (!Number.isFinite(n)) continue;
      tabindex = n;
    }
    if (tabindex < 0) continue;

    entries.push({ el, tabindex, order: i });
  }

  const positives = entries
    .filter((e) => e.tabindex > 0)
    .sort((a, b) =>
      a.tabindex === b.tabindex ? a.order - b.order : a.tabindex - b.tabindex,
    );
  const zeros = entries
    .filter((e) => e.tabindex === 0)
    .sort((a, b) => a.order - b.order);

  return [...positives, ...zeros].map((e) => e.el);
}

/**
 * Move focus to the next (or previous) tabbable in `doc`. When focus is
 * inside an open `<dialog>`, the sequence is scoped to that dialog (focus
 * trap). Wraps at the ends so the keyboard bar stays useful on a single
 * page without leaving for browser chrome.
 */
export function moveFocusAlongTabSequence(
  doc: Document,
  direction: 1 | -1,
): void {
  const active = doc.activeElement;
  const dialog =
    active instanceof Element ? active.closest("dialog[open]") : null;
  const root: ParentNode = dialog ?? doc;
  const seq = collectTabSequence(root);
  if (seq.length === 0) return;

  let idx = active instanceof HTMLElement ? seq.indexOf(active) : -1;
  if (idx === -1 && active instanceof Element) {
    for (let i = 0; i < seq.length; i++) {
      if (seq[i].contains(active)) {
        idx = i;
        break;
      }
    }
  }

  const nextIdx =
    idx === -1
      ? direction === 1
        ? 0
        : seq.length - 1
      : (idx + direction + seq.length) % seq.length;

  seq[nextIdx].focus();
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

function applyNativeDefault(payload: SendKeyPayload, doc: Document): void {
  if (payload.key === "Tab") {
    moveFocusAlongTabSequence(doc, payload.modifiers?.shift ? -1 : 1);
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
export function sendKey(target: EventTarget, payload: SendKeyPayload): void {
  const init = eventInit(payload);
  const allowed = target.dispatchEvent(new KeyboardEvent("keydown", init));
  if (allowed) {
    applyNativeDefault(payload, ownerDocument(target));
  }
  target.dispatchEvent(new KeyboardEvent("keyup", init));
}
