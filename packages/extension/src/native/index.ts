/// <reference types="chrome" />

/**
 * Native-mode entry point (RFC PR H). Registered unconditionally from the
 * service worker (`background.ts`) — the capability ships in every build now
 * that `public/manifest.json` carries `debugger`/`tabs`/`storage` as required
 * permissions. What keeps it off by default is the setting below: every
 * `chrome.debugger` use still refuses until a user explicitly turns native
 * mode on, enforced inside `NativeDebuggerSession.attach()` itself so "off"
 * and "attached" stay mutually exclusive.
 *
 * This wires the panel↔SW messages for reading Chromium's native tree over
 * `chrome.debugger`, acting through it, and exporting the dogfood report. All
 * AX logic lives in native-core; the debugger plumbing in debugger-session.
 */

import { isExtensionPageSender } from "../routing.js";

import {
  classifyAttachError,
  classifyTabUrl,
  type NativeUnavailableReason,
  type TabCapability,
} from "./capability.js";
import {
  NativeDebuggerSession,
  type OperationOptions,
} from "./debugger-session.js";
import type { DogfoodLog } from "./dogfood.js";
import {
  dispatchNative,
  nativeIdForBackendNode,
  readNativeTree,
  type NativeAction,
} from "./native-core.js";

const FLAG_KEY = "settings.nativeModeEnabled";
/** The dogfood build's name for the same setting, before it became a user
 *  setting. Read once, carried over, then removed — see `migrateFlag`. */
const LEGACY_FLAG_KEY = "devFlags.nativeMode";

declare const __DOGFOOD__: boolean;
/** True only in the `DOGFOOD=1` build (`vite.config.ts`). The store build
 *  dead-code-eliminates everything this guards. */
const DOGFOOD = typeof __DOGFOOD__ !== "undefined" && __DOGFOOD__;

/** A storage area that keeps nothing. The store build hands it to the event
 *  log, so the log's writes go nowhere and nothing durable is kept about how
 *  native mode was used. Only the dogfood build records — and reads — it. */
const discardingStorage: chrome.storage.StorageArea = {
  get: async () => ({}),
  set: async () => {},
} as unknown as chrome.storage.StorageArea;

/** Carry a dogfooder's old `devFlags.nativeMode: true` over to the new key,
 *  then drop the old key so it doesn't linger in their storage. */
async function migrateFlag(): Promise<void> {
  const got = await chrome.storage.local.get([FLAG_KEY, LEGACY_FLAG_KEY]);
  if (!(LEGACY_FLAG_KEY in got)) return;
  if (got[LEGACY_FLAG_KEY] === true && got[FLAG_KEY] === undefined) {
    await chrome.storage.local.set({ [FLAG_KEY]: true });
  }
  await chrome.storage.local.remove(LEGACY_FLAG_KEY);
}

/** The user-facing native-mode setting — off unless explicitly turned on. */
async function nativeModeEnabled(): Promise<boolean> {
  const got = await chrome.storage.local.get(FLAG_KEY);
  return got[FLAG_KEY] === true;
}

/** Request/response messages the panel sends for native mode. Pushes the
 *  other way (`NATIVE_PICK_RESULT`, `NATIVE_PICK_ARMED`) are typed in
 *  `../types.ts` with the panel's other inbound messages, because the panel's
 *  one message handler routes them. */
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
      // A background follow (e.g. the tree's own selection moving real page
      // focus, App.tsx's `revealNativeSelectionOnPage`), not a user-dispatched
      // action from the toolbar/row buttons — kept out of the dogfood log's
      // `act` count. That count (and its success ratio) is how a dogfooder
      // judges how much native mode was actually USED; counting an automatic
      // follow that fires on every settled tree selection would silently
      // inflate it with browsing, not real dispatches.
      silent?: boolean;
      // For a `reveal`: the panel's sequence number for it. A queued reveal
      // that a newer one on the same tab has replaced is dropped before it
      // attaches.
      requestId?: number;
      // The URL of the document the caller's tree was read from. Checked
      // after the per-tab queue wait, right before dispatch: a node id
      // encodes a `backendDOMNodeId`, which the page it came from owns, and
      // an action sent just before a navigation would otherwise resolve
      // that id in the NEW document — possibly an unrelated element there.
      // Optional, so existing callers keep their behavior unchanged.
      expectUrl?: string;
    }
  | { type: "NATIVE_DOGFOOD_REPORT" }
  | { type: "NATIVE_DOGFOOD_CLEAR" }
  // Picker: arm CDP's element picker on `tabId`. Acknowledged immediately
  // (the pick itself can take as long as the user needs to click) — the
  // actual outcome arrives later as a `NATIVE_PICK_RESULT` push to the
  // panel, mirroring how the DOM picker's own NODE_PICKED works.
  // `requestId` is opaque here — the background only ever echoes it back
  // verbatim on the eventual result — but the panel needs it: a STOP
  // immediately followed by a new START on the same tab leaves every token
  // it already tracks unchanged (nothing about the tab or document moved),
  // so without a per-arm id the old pick's delayed result is
  // indistinguishable from the new one's.
  | { type: "NATIVE_PICK_START"; tabId: number; requestId: number }
  // Picker: cancel the pick `requestId` on `tabId` — explicit toggle-off, or
  // the panel leaving native mode or switching tabs. Naming the request keeps
  // a late STOP from cancelling a later pick.
  | { type: "NATIVE_PICK_STOP"; tabId: number; requestId: number };

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

/** The session `registerNativeMode` created, for {@link cancelNativePicks}. */
let activeSession: NativeDebuggerSession | undefined;

/** End every pick in progress. The background calls this when the last side
 *  panel closes: nobody is left to receive the pick, and an armed pick would
 *  otherwise keep the debugger attached, and eat the next page click, until
 *  its time limit. */
export function cancelNativePicks(): void {
  activeSession?.cancelAllPicks();
}
// Pairs each `reveal` dispatch's content-script arm with its own release —
// see the NATIVE_ACT handler.
let revealSeq = 0;
// The latest reveal the panel asked for, per tab (its `requestId`).
const latestReveal = new Map<number, number>();

export function registerNativeMode(): void {
  // Content scripts can read and write `chrome.storage.local` by default. They
  // run in the page's renderer, and nothing they do needs storage, so keep
  // the native-mode setting out of their reach.
  void chrome.storage.local
    .setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" })
    .catch(() => {});
  // Every read and write of the setting waits for the migration: one that
  // ran alongside a Disable could otherwise write its carried-over `true`
  // after the user's `false`.
  const migrated = migrateFlag().catch(() => {});
  const flagEnabled = async () => {
    await migrated;
    return nativeModeEnabled();
  };

  // The dogfood build keeps its event log in `local`, so it survives restarts
  // for the dogfooder's report; the store build keeps none (see
  // `discardingStorage`). Attach bookkeeping is per browser session
  // (`session`): it outlives a service-worker suspend but not a browser
  // restart, the exact lifetime of a debugger attachment, and keeping it out of
  // memory is what lets an unsolicited detach survive the suspend it measures.
  const session = new NativeDebuggerSession(
    DOGFOOD ? chrome.storage.local : discardingStorage,
    chrome.storage.session ?? chrome.storage.local,
    // The flag is enforced INSIDE the attach transaction, not by the callers.
    // That is what makes it atomic against `detachAll`, and it is why no
    // message handler re-checks it before dispatching.
    flagEnabled,
  );
  activeSession = session;
  const log = session.dogfoodLog();

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isNativeMessage(message)) return; // not ours — let other handlers run
    // These messages route the most powerful capability the extension has —
    // reading/dispatching over chrome.debugger and toggling the setting — so
    // only the extension's own pages may send them. A content script carries
    // the extension's id too, and runs in the page's process.
    if (
      !isExtensionPageSender(
        sender,
        chrome.runtime.id,
        chrome.runtime.getURL(""),
      )
    ) {
      return false;
    }

    void (async () => {
      try {
        // The dogfood build's report and clear buttons. Written as a guarded
        // block rather than switch cases so the store build drops the code,
        // and the message names, entirely; there it falls through to
        // "unsupported" below.
        if (DOGFOOD && message.type === "NATIVE_DOGFOOD_REPORT") {
          sendResponse({ report: await log.report(Date.now()) });
          return;
        }
        if (DOGFOOD && message.type === "NATIVE_DOGFOOD_CLEAR") {
          await log.clear();
          sendResponse({ ok: true });
          return;
        }
        switch (message.type) {
          case "NATIVE_FLAG_GET":
            sendResponse({ enabled: await flagEnabled() });
            return;
          case "NATIVE_FLAG_SET": {
            await migrated;
            await chrome.storage.local.set({ [FLAG_KEY]: message.enabled });
            // Cancel any in-flight picker session BEFORE detachAll: a pick
            // that never got a click is still occupying that tab's slot in
            // the per-tab operation queue detachAll waits on (see
            // `cancelAllPicks`'s own comment) — without this, turning native
            // mode off would hang until the user happened to click
            // something.
            if (!message.enabled) session.cancelAllPicks();
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
              keptCount: value.keptCount,
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
              // The id of the tree's one root (a synthesized wrapper when
              // Chromium's own tree has more than one parent-less node —
              // see `rootIdOf` in native-core.ts) — what a real expand/
              // collapse tree UI needs to render from, unlike the dogfood
              // panel's flat depth-indented list, which never needed one.
              rootId: value.rootId,
              // Structural fields plus the state/property enrichment
              // `readNativeTree` attaches (`expanded`, `checked`, `level`, …).
              // `axFacets`'s own allowlist (DETAIL_PROPS) excludes
              // `valuenow`/`valuetext`, the two AX properties that would
              // carry a value-bearing control's current input straight from
              // Chromium's own (incompletely-redacted) CDP payload — `value`
              // is a SEPARATE field: the announced value (ADR-0001), used
              // only once `pageReadValue` has classified the element in-page
              // (password fields and sensitive autocomplete tokens arrive as
              // "[redacted]", never the live text), not a bypass of that
              // exclusion. `rawValue` is the same classified read's raw
              // field value, for a retype's prefill. `description`
              // is Chromium's own `aria-describedby`/`aria-description`
              // resolution — page-authored help/error text, not user input,
              // so it carries no R1 concern (same distinction `browser`'s own
              // native producer already draws for it). `placeholder` is the
              // same kind of page-authored, non-redacted text. `childIds` is
              // what lets a consumer render an actual tree instead of a flat
              // depth-indented list. `controls` is the `aria-controls`
              // relation as row ids — structure, not content.
              // `valueWithheld` is the field's in-page sensitivity verdict,
              // a boolean, never the value it withholds.
              nodes: value.nodes.map((n) => ({
                id: n.id,
                role: n.role,
                name: n.name,
                depth: n.depth,
                childIds: n.childIds,
                states: n.states,
                properties: n.properties,
                value: n.value,
                redacted: n.redacted,
                rawValue: n.rawValue,
                placeholder: n.placeholder,
                description: n.description,
                controls: n.controls,
                valueWithheld: n.valueWithheld,
              })),
            });
            return;
          }
          case "NATIVE_ACT": {
            const isReveal = message.action === "reveal";
            if (isReveal && message.requestId !== undefined) {
              latestReveal.set(message.tabId, message.requestId);
            }
            const { outcome, value } = await withRecovery(
              session,
              message.tabId,
              async (t) => {
                // A reveal skips the page check: a same-page URL change
                // (pushState, a hash) leaves the node ids valid, and an id
                // from a different document fails safely in DOM.resolveNode.
                if (
                  !isReveal &&
                  message.expectUrl !== undefined &&
                  (await tabUrl(message.tabId)) !== message.expectUrl
                ) {
                  return {
                    success: false,
                    error: "page navigated — reload the native tree",
                  };
                }
                if (!isReveal) {
                  return dispatchNative(
                    t,
                    message.nodeId,
                    message.action,
                    message.value,
                  );
                }
                // Arm the content script, reveal, release. Armed here, after
                // the per-tab queue wait and right beside the dispatch it
                // covers, so a long queue can't outlast its deadline. Only
                // the top frame: the native tree reads the top frame alone,
                // so a reveal target never lives in a subframe, and arming
                // third-party frames would only widen the window. The nonce
                // reaches the page only as `pageReveal`'s argument.
                const seq = ++revealSeq;
                const nonce = crypto.randomUUID();
                const arm = (active: boolean) =>
                  chrome.tabs
                    .sendMessage(
                      message.tabId,
                      {
                        type: "ARM_NATIVE_OVERLAY",
                        payload: { seq, active, ...(active ? { nonce } : {}) },
                      },
                      { frameId: 0 },
                    )
                    .then(() => true)
                    .catch(() => false);
                // No content script answered (one that can't run here, or
                // one orphaned by an extension reload): focus still moves,
                // but nothing will draw the outline, and the panel is told.
                const outlined = await arm(true);
                try {
                  const result = await dispatchNative(
                    t,
                    message.nodeId,
                    "reveal",
                    nonce,
                  );
                  return result.success ? { ...result, outlined } : result;
                } finally {
                  await arm(false);
                }
              },
              log,
              isReveal && message.requestId !== undefined
                ? {
                    stillWanted: () =>
                      latestReveal.get(message.tabId) === message.requestId,
                  }
                : {},
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
            if (!message.silent) {
              await log.record({
                kind: "act",
                at: Date.now(),
                action: message.action,
                success: result.success,
              });
            }
            sendResponse(result);
            return;
          }
          case "NATIVE_PICK_START": {
            // Acknowledged at once: the pick lasts as long as the user takes
            // to click. Its outcome (a node, a cancel, a timeout or a failure)
            // arrives later as a NATIVE_PICK_RESULT push, and a
            // NATIVE_PICK_ARMED push says when a click on the page becomes a
            // pick.
            sendResponse({ ok: true });
            const { tabId, requestId } = message;
            // Captured now, so turning native mode off before this pick
            // registers still cancels it (see `cancelAllPicks`).
            const generation = session.pickGeneration();
            let timedOut = false;
            void (async () => {
              const { outcome, value: picked } = await withRecovery(
                session,
                tabId,
                (t) =>
                  session.runPick(tabId, t, {
                    requestId,
                    generation,
                    onArmed: () => {
                      void chrome.runtime
                        .sendMessage({
                          type: "NATIVE_PICK_ARMED",
                          tabId,
                          requestId,
                        })
                        .catch(() => {});
                    },
                    onTimeout: () => {
                      timedOut = true;
                    },
                  }),
                log,
                // Never re-arm a pick on our own after Chrome detached it. A
                // detach whose reason `detachEndsPick` knows ends the pick as
                // a cancel, armed or still being armed. What still arrives as
                // a drop is an unknown reason, or a setup the session dropped
                // under with no reason ever coming. Attaching again undoes
                // neither, and could re-attach over the user's Cancel.
                { pick: true, retryDrop: false },
              );
              // Kept apart all the way to the panel: a failure to attach or
              // arm (`outcome.ok === false`) is not the user pressing Escape
              // (`picked === null`), and neither is a timeout. A detach
              // Chrome reports with a reason `detachEndsPick` knows — the
              // user's Cancel on the debugging bar, the tab closing — is a
              // cancel too, whether the pick was armed or still arming.
              const payload = !outcome.ok
                ? {
                    error: outcome.error ?? "pick failed",
                    ...(outcome.reason ? { reason: outcome.reason } : {}),
                  }
                : picked
                  ? {
                      // The hit, then its ancestors, for when the hit itself
                      // isn't a node the AX tree kept.
                      nodeId: nativeIdForBackendNode(picked.backendNodeId),
                      ancestorIds: picked.chainBackendNodeIds
                        .slice(1)
                        .map(nativeIdForBackendNode),
                    }
                  : { cancelled: true, ...(timedOut ? { timedOut } : {}) };
              void chrome.runtime
                .sendMessage({
                  type: "NATIVE_PICK_RESULT",
                  tabId,
                  requestId,
                  payload,
                })
                .catch(() => {});
            })();
            return;
          }
          case "NATIVE_PICK_STOP": {
            sendResponse({
              ok: true,
              cancelled: session.cancelPick(message.tabId, message.requestId),
            });
            return;
          }
        }
        // Only reached by a message this build doesn't handle (the dogfood
        // report and clear, in the store build). Answer it rather than leave it
        // hanging.
        sendResponse({ ok: false, error: "unsupported" });
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
  opts: OperationOptions = {},
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

  const first = await runGuarded(session, tabId, fn, opts);
  if (first.outcome.ok) return first;
  // A conflict won't clear on its own, and `disabled` means the user switched
  // native off — retrying either would be re-attaching against the answer.
  if (
    first.outcome.error === "conflict" ||
    first.outcome.error === "disabled" ||
    first.outcome.error === "superseded"
  ) {
    return await classify(first, log);
  }

  if (first.outcome.error === "connection-lost" && opts.retryDrop === false) {
    // The caller declined the retry. The drop is already booked as
    // `detach-unsolicited`, so it still needs a verdict, or the ledger
    // carries a debit with no matching credit — and with nothing attempted,
    // that verdict is `reattach-abandoned`, not a failure.
    await session.dogfoodLog().record({
      kind: "reattach-abandoned",
      at: Date.now(),
    });
    return await classify(first, log);
  }

  const retry = await runGuarded(session, tabId, fn, opts);
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
  opts: OperationOptions = {},
): Promise<{ outcome: { ok: boolean; error?: string }; value?: T }> {
  try {
    return await session.withDebugger(tabId, fn, opts);
  } catch {
    return { outcome: { ok: false, error: "command-failed" } };
  }
}
