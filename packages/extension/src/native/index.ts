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

import {
  classifyAttachError,
  classifyTabUrl,
  type NativeUnavailableReason,
  type TabCapability,
} from "./capability.js";
import { NativeDebuggerSession } from "./debugger-session.js";
import type { DogfoodLog } from "./dogfood.js";
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
  | { type: "NATIVE_CAPABILITY"; tabId: number }
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

/**
 * What native can do on this tab, without attaching. An unreadable URL is a
 * `no-url` refusal rather than an optimistic attempt: `chrome.tabs.get` fails
 * on exactly the tabs the debugger also can't have (gone, or privileged), so
 * attempting anyway buys a banner flash and the same answer.
 */
async function capabilityOf(tabId: number): Promise<TabCapability> {
  return classifyTabUrl(await tabUrl(tabId), {
    // `file://` is blocked by default, not outright: with "Allow access to file
    // URLs" on, both producers work there. Ask rather than assume, so a
    // dogfooder who enabled it isn't refused — and doesn't get a `file-url`
    // entry in the capability split that misrepresents their setup.
    fileAccess: await fileSchemeAccess(),
  });
}

/** Whether the user granted "Allow access to file URLs". Absent on old builds
 *  and in tests, where the safe answer is the restrictive one. */
async function fileSchemeAccess(): Promise<boolean> {
  try {
    return await chrome.extension.isAllowedFileSchemeAccess();
  } catch {
    return false;
  }
}

/**
 * Record an unavailable-native event and return the fields the panel needs to
 * explain it. The reason is a static code from a closed set — the whole point
 * of classifying is that neither the log nor the panel ever carries Chrome's
 * own message, which can quote page or DevTools state (R6).
 */
async function refuse(
  log: DogfoodLog,
  reason: NativeUnavailableReason,
): Promise<{ reason: NativeUnavailableReason }> {
  await log.record({ kind: "unavailable", at: Date.now(), reason });
  return { reason };
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
    // The flag is enforced INSIDE the attach transaction, not by the callers.
    // That is what makes it atomic against `detachAll`, and it is why no
    // message handler re-checks it before dispatching.
    nativeModeEnabled,
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
          case "NATIVE_FLAG_SET": {
            await chrome.storage.local.set({ [FLAG_KEY]: message.enabled });
            // Turning it off must drop the capability, not merely stop offering
            // it. `debugger` cannot be optional, so there is no permission to
            // revoke — "off" can only mean "not attached", and an attachment
            // stranded by an MV3 suspend would otherwise keep the banner up on
            // a tab the user just switched native off for.
            const detached = message.enabled ? 0 : await session.detachAll();
            sendResponse({ enabled: message.enabled, detached });
            return;
          }
          case "NATIVE_CAPABILITY":
            // Pre-flight only — no attach, so asking the question never costs a
            // banner flash. The panel calls this to decide whether to offer the
            // native controls at all.
            //
            // Deliberately NOT gated on `nativeModeEnabled()`, unlike the two
            // handlers below. It exercises no `debugger` capability, and the
            // panel needs the answer while the flag is still off — that is what
            // lets the toggle report "native unavailable here" the moment it is
            // ticked, instead of after a failed read. It returns only the
            // reason enum, never the URL it classified.
            sendResponse(await capabilityOf(message.tabId));
            return;
          case "NATIVE_DOGFOOD_REPORT":
            sendResponse({ report: await log.report(Date.now()) });
            return;
          case "NATIVE_DOGFOOD_CLEAR":
            await log.clear();
            sendResponse({ ok: true });
            return;
          case "NATIVE_READ": {
            const { outcome, value } = await withRecovery(
              session,
              message.tabId,
              (t) => readNativeTree(t),
              log,
            );
            if (!outcome.ok || !value) {
              sendResponse({
                ok: false,
                error: outcome.error ?? "read failed",
                ...(outcome.reason ? { reason: outcome.reason } : {}),
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
              log,
            );
            if (!outcome.ok) {
              // Nothing was dispatched, so nothing is recorded as an `act`.
              // Counting these would both overstate "actions dispatched" and
              // depress the act success ratio with failures already counted
              // under Capability — the same incident moving two numbers in
              // opposite directions. NATIVE_READ has always returned first on
              // its non-dispatch paths; this now matches it.
              sendResponse({
                success: false,
                error: outcome.error ?? "act failed",
                ...(outcome.reason ? { reason: outcome.reason } : {}),
              });
              return;
            }
            const result = value ?? { success: false, error: "no result" };
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
 * The single funnel every native operation passes through: capability
 * pre-flight, attach with one retry, and the reattach accounting.
 *
 * The pre-flight lives HERE rather than in each message handler. Copied per
 * case it drifted immediately — `NATIVE_READ` had one and `NATIVE_ACT` did not,
 * so the same blocked page reported `browser-ui` for a read and
 * `attach-refused` for a click, skewing the very split the verdict is read
 * from, and burning two attach round-trips to do it. A third native message
 * would have needed a third copy.
 *
 * Recording the refusal here is also what makes the Capability metric real: the
 * panel no longer pre-empts the call, so every refusal — URL-derived or
 * attach-derived — reaches the log through one writer.
 *
 * The native-mode flag is NOT checked here. It is enforced inside
 * `NativeDebuggerSession.attach()`, on the same storage queue the revoke uses,
 * which is the only placement that makes "switched off" and "attached"
 * mutually exclusive rather than merely usually-ordered.
 */
export async function withRecovery<T>(
  session: NativeDebuggerSession,
  tabId: number,
  fn: (t: import("./native-core.js").CdpTransport) => Promise<T>,
  log?: DogfoodLog,
): Promise<{
  outcome: { ok: boolean; error?: string; reason?: NativeUnavailableReason };
  value?: T;
}> {
  // Cheap, and it costs no attach — so a `chrome://` tab is named without ever
  // flashing the banner on its way to a bare failure.
  const capability = await capabilityOf(tabId);
  if (!capability.native) {
    return {
      outcome: {
        ok: false,
        error: "unavailable",
        ...(log
          ? await refuse(log, capability.reason!)
          : { reason: capability.reason! }),
      },
    };
  }

  const first = await runGuarded(session, tabId, fn);
  if (first.outcome.ok) return first;
  // A conflict won't clear on its own, and `disabled` means the user switched
  // native off — retrying either would be re-attaching against the answer.
  if (
    first.outcome.error === "conflict" ||
    first.outcome.error === "disabled"
  ) {
    return await classify(first, log);
  }

  const retry = await runGuarded(session, tabId, fn);
  // Only a mid-operation drop (we WERE attached, then lost it) is a lifecycle
  // recovery worth measuring. A fresh attach failure is a page/permission
  // problem, not an MV3 suspend/wake, so it must not touch the reattach metric.
  if (first.outcome.error === "connection-lost") {
    await session.dogfoodLog().record({
      // A drop was already booked as `detach-unsolicited` upstream, so it needs
      // a verdict or the ledger carries a debit with no matching credit. When
      // the retry was refused because native went off, neither `ok` nor
      // `failed` is true — nothing was attempted — so it gets its own kind
      // rather than overstating a failure.
      kind:
        retry.outcome.error === "disabled"
          ? "reattach-abandoned"
          : retry.outcome.ok
            ? "reattach-ok"
            : "reattach-failed",
      at: Date.now(),
    });
  }
  return await classify(retry, log);
}

/**
 * Turn an attach-level failure into the capability vocabulary the panel speaks,
 * recording it on the way. The URL pre-flight is a heuristic over a Chrome
 * policy that shifts between versions, so the attach itself stays
 * authoritative — and its answer is counted the same way.
 */
async function classify<T>(
  result: { outcome: { ok: boolean; error?: string }; value?: T },
  log?: DogfoodLog,
): Promise<{
  outcome: { ok: boolean; error?: string; reason?: NativeUnavailableReason };
  value?: T;
}> {
  const { outcome } = result;
  if (outcome.error !== "conflict" && outcome.error !== "attach-failed") {
    return result;
  }
  const reason = classifyAttachError(outcome.error);
  if (log) await refuse(log, reason);
  return { outcome: { ok: false, error: "unavailable", reason } };
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
