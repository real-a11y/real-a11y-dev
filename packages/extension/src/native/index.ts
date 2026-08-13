/// <reference types="chrome" />

/**
 * Native-mode entry point (RFC PR H dogfood). Registered from the service worker
 * ONLY in the dogfood build (behind the `__DOGFOOD__` build constant, so it is
 * dead-code-eliminated from the store build) AND only while the runtime dev flag
 * is on — defence in depth so the `debugger` capability is never live by default.
 *
 * This wires the panel↔SW messages for reading Chromium's native tree over
 * `chrome.debugger`, acting through it, and exporting the dogfood report. All
 * AX logic lives in native-core; the debugger plumbing in debugger-session.
 */

import { isTrustedSender } from "../routing.js";

import { NativeDebuggerSession } from "./debugger-session.js";
import {
  dispatchNative,
  readNativeTree,
  type NativeAction,
} from "./native-core.js";

const FLAG_KEY = "devFlags.nativeMode";

/** Runtime dev flag — off unless a dogfooder explicitly turns it on. */
async function nativeModeEnabled(): Promise<boolean> {
  const got = await chrome.storage.local.get(FLAG_KEY);
  return got[FLAG_KEY] === true;
}

/** Messages the panel sends for native mode (kept out of the main types so this
 *  whole module lifts cleanly if the dogfood verdict is "no"). */
type NativeMessage =
  | { type: "NATIVE_FLAG_GET" }
  | { type: "NATIVE_FLAG_SET"; enabled: boolean }
  | { type: "NATIVE_READ"; tabId: number }
  | {
      type: "NATIVE_ACT";
      tabId: number;
      nodeId: string;
      action: NativeAction;
      value?: string;
    }
  | { type: "NATIVE_DOGFOOD_REPORT" }
  | { type: "NATIVE_DOGFOOD_CLEAR" };

/** The tab's current URL, or undefined if it can't be read. Best-effort: it
 *  only drives a staleness check, so a miss degrades to "don't refuse". */
async function tabUrl(tabId: number): Promise<string | undefined> {
  try {
    return (await chrome.tabs.get(tabId)).url;
  } catch {
    return undefined;
  }
}

function isNativeMessage(m: unknown): m is NativeMessage {
  return (
    typeof m === "object" &&
    m !== null &&
    typeof (m as { type?: unknown }).type === "string" &&
    (m as { type: string }).type.startsWith("NATIVE_")
  );
}

export function registerNativeMode(): void {
  // The dogfood log is durable (`local` — it spans the ~2-week exercise);
  // attach bookkeeping is per-browser-session (`session`), which outlives a
  // service-worker suspend but not a browser restart — the exact lifetime of a
  // debugger attachment. Keeping it out of memory is what lets the unsolicited
  // detach survive the very suspend it measures.
  const session = new NativeDebuggerSession(
    chrome.storage.local,
    chrome.storage.session ?? chrome.storage.local,
  );
  const log = session.dogfoodLog();

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isNativeMessage(message)) return; // not ours — let other handlers run
    // These messages route the most powerful capability the extension has —
    // reading/dispatching over chrome.debugger and toggling the runtime flag.
    // onMessage is same-extension only, so this never rejects in practice, but
    // the rest of the codebase asserts the trust boundary on privileged
    // handlers (background.ts, content.ts); native mode holds itself to the
    // same bar as defence in depth.
    if (!isTrustedSender(sender, chrome.runtime.id)) return false;

    void (async () => {
      try {
        switch (message.type) {
          case "NATIVE_FLAG_GET":
            sendResponse({ enabled: await nativeModeEnabled() });
            return;
          case "NATIVE_FLAG_SET":
            await chrome.storage.local.set({ [FLAG_KEY]: message.enabled });
            sendResponse({ enabled: message.enabled });
            return;
          case "NATIVE_DOGFOOD_REPORT":
            sendResponse({ report: await log.report(Date.now()) });
            return;
          case "NATIVE_DOGFOOD_CLEAR":
            await log.clear();
            sendResponse({ ok: true });
            return;
          case "NATIVE_READ": {
            if (!(await nativeModeEnabled())) {
              sendResponse({ ok: false, error: "native mode is off" });
              return;
            }
            const { outcome, value } = await withRecovery(
              session,
              message.tabId,
              (t) => readNativeTree(t),
            );
            if (!outcome.ok || !value) {
              sendResponse({
                ok: false,
                error: outcome.error ?? "read failed",
              });
              return;
            }
            await log.record({
              kind: "read",
              at: Date.now(),
              rawCount: value.rawCount,
              keptCount: value.nodes.length,
            });
            sendResponse({
              ok: true,
              serialized: value.serialized,
              // The document this tree describes. Native node ids encode
              // Chromium `backendDOMNodeId`s, which a navigation invalidates
              // wholesale — the panel compares this before acting so it can
              // refuse a dispatch against ids that no longer mean anything.
              // Not recorded in the dogfood log, which stays content-free.
              url: await tabUrl(message.tabId),
              // Only structural fields — never page-derived secrets beyond the
              // accessible name the tree already shows.
              nodes: value.nodes.map((n) => ({
                id: n.id,
                role: n.role,
                name: n.name,
                depth: n.depth,
              })),
            });
            return;
          }
          case "NATIVE_ACT": {
            if (!(await nativeModeEnabled())) {
              sendResponse({ success: false, error: "native mode is off" });
              return;
            }
            const { outcome, value } = await withRecovery(
              session,
              message.tabId,
              (t) =>
                dispatchNative(
                  t,
                  message.nodeId,
                  message.action,
                  message.value,
                ),
            );
            const result = outcome.ok
              ? (value ?? { success: false, error: "no result" })
              : { success: false, error: outcome.error ?? "act failed" };
            await log.record({
              kind: "act",
              at: Date.now(),
              action: message.action,
              success: result.success,
            });
            sendResponse(result);
            return;
          }
        }
      } catch {
        sendResponse({ ok: false, error: "native mode error" });
      }
    })();

    return true; // async sendResponse
  });
}

/**
 * Run an operation, retrying once, and record a reattach ONLY when the
 * connection dropped mid-operation — the classic MV3 suspend/wake, which is the
 * lifecycle signal PR H measures.
 *
 * That drop does not surface as an attach failure: it surfaces as a THROW from
 * the CDP call inside `withDebugger` (only the transport throws — `dispatchNative`
 * swallows its own errors into structured results), which `runGuarded` tags
 * `connection-lost`. Only that case records `reattach-ok`/`reattach-failed`.
 *
 * A plain `attach-failed` (attach never succeeded — a `chrome://`/Web-Store page
 * or a debugger-forbidden tab) is retried best-effort but NOT recorded: it is a
 * permanent/page failure, not a service-worker lifecycle recovery, and counting
 * it would inflate the "reattach failed" number the ship/no-ship decision rests
 * on. A `conflict` (DevTools attached) is not retried — it won't clear on its own.
 */
export async function withRecovery<T>(
  session: NativeDebuggerSession,
  tabId: number,
  fn: (t: import("./native-core.js").CdpTransport) => Promise<T>,
): Promise<{ outcome: { ok: boolean; error?: string }; value?: T }> {
  const first = await runGuarded(session, tabId, fn);
  if (first.outcome.ok || first.outcome.error === "conflict") return first;

  const retry = await runGuarded(session, tabId, fn);
  // Only a mid-operation drop (we WERE attached, then lost it) is a lifecycle
  // recovery worth measuring. A fresh attach failure is a page/permission
  // problem, not an MV3 suspend/wake, so it must not touch the reattach metric.
  if (first.outcome.error === "connection-lost") {
    await session.dogfoodLog().record({
      kind: retry.outcome.ok ? "reattach-ok" : "reattach-failed",
      at: Date.now(),
    });
  }
  return retry;
}

/**
 * Backstop around `withDebugger`, which already classifies a mid-operation
 * failure itself (`connection-lost` vs `command-failed`) rather than throwing.
 * Anything that still escapes is unclassifiable, so it defaults to
 * `command-failed` — the tag that does NOT count toward the reattach metric.
 * Guessing `connection-lost` here would inflate the dogfood's headline
 * lifecycle number with failures that were never lifecycle events.
 */
export async function runGuarded<T>(
  session: NativeDebuggerSession,
  tabId: number,
  fn: (t: import("./native-core.js").CdpTransport) => Promise<T>,
): Promise<{ outcome: { ok: boolean; error?: string }; value?: T }> {
  try {
    return await session.withDebugger(tabId, fn);
  } catch {
    return { outcome: { ok: false, error: "command-failed" } };
  }
}
