/**
 * Can native mode work on this tab, and if not, what should we say?
 *
 * Native reads Chromium's tree over `chrome.debugger`, which Chrome forbids on
 * a set of privileged pages. Session 1 surfaced every one of those as a bare
 * `attach-failed`, which reads as a bug in the extension rather than a platform
 * rule — and each attempt still flashed the "…started debugging this browser" banner
 * on the way to failing.
 *
 * Two layers, because neither is sufficient alone:
 *
 *  - **Pre-flight** ({@link classifyTabUrl}) — a URL check, so the common cases
 *    are named *without* attaching at all: no banner flash, no wasted attach in
 *    the dogfood numbers. It is a heuristic: the blocked set is a Chrome policy
 *    that shifts between versions, so this can be wrong in the safe direction
 *    (says attachable, attach then fails).
 *  - **Post-hoc** ({@link classifyAttachError}) — the authoritative answer, from
 *    what the attach actually did. A tab that passed pre-flight and still failed
 *    lands here.
 *
 * The reasons are a closed set of static codes, never Chrome's message text —
 * a `chrome.runtime.lastError` can quote page or DevTools state (R6).
 */

/** Why native is unavailable. Static codes: safe to log, safe to display. */
export type NativeUnavailableReason =
  | "browser-ui" // chrome://, devtools://, about: — Chrome blocks extensions
  | "extension-page" // another extension's pages, including this one's
  | "web-store" // the Web Store is blocked even to the debugger
  | "view-source" // view-source: has no attachable document
  | "file-url" // file:// needs "Allow access to file URLs"
  | "no-url" // the tab's URL could not be read
  | "devtools-conflict" // DevTools (or another client) holds the tab
  | "attach-refused"; // attach failed and Chrome did not say why

export interface TabCapability {
  /** Native (`chrome.debugger`) can attach here. */
  native: boolean;
  /** Only when `native` is false. */
  reason?: NativeUnavailableReason;
}

const ATTACHABLE: TabCapability = { native: true };

/** The capability a refusal implies, from the reason alone. Used by the panel
 *  for a reason that arrived over messaging, where the URL is not in hand. */
export function blockedBy(reason: NativeUnavailableReason): TabCapability {
  return { native: false, reason };
}

/**
 * Pre-flight: what the tab's URL says about attachability.
 *
 * `about:blank` and `about:srcdoc` are deliberately treated as attachable —
 * they are ordinary documents a debugger attaches to happily. The rest of the
 * `about:` space is browser UI (Chrome rewrites `about:settings` and friends to
 * `chrome://`, so what remains here is rare, but it is not a page).
 */
export function classifyTabUrl(
  url: string | undefined,
  opts: { fileAccess?: boolean } = {},
): TabCapability {
  // An EMPTY url is not an unreadable one. `chrome.tabs.get` returns `url: ""`
  // for a tab that has not committed its navigation yet — a successful call
  // about an ordinary page — so refusing it would fail closed on exactly the
  // case that resolves itself a moment later, and would put a bogus `no-url`
  // row in the capability split. `undefined` is the real unknown: the caller
  // could not read the tab at all.
  if (url === "") return ATTACHABLE;
  if (url === undefined) return blockedBy("no-url");

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Not a URL we can reason about. Don't claim it's blocked — let the attach
    // decide, and classify the failure if there is one.
    return ATTACHABLE;
  }

  const scheme = parsed.protocol.toLowerCase();

  if (scheme === "about:") {
    // `parsed.pathname`, not a slice of the raw url — otherwise `about:blank#x`
    // and `about:blank?a=1` miss the allow-list and land on `browser-ui`, the
    // single worst reason to land on (non-retryable, and one where Chrome
    // blocks the content script too) for a document that is perfectly
    // attachable.
    // Chrome itself produces `about:blank#blocked`. Lowercase moves with it,
    // since pathname preserves case.
    const rest = parsed.pathname.toLowerCase();
    return rest === "blank" || rest === "srcdoc"
      ? ATTACHABLE
      : blockedBy("browser-ui");
  }
  if (scheme === "view-source:") return blockedBy("view-source");
  // `file://` is not blocked outright — it is blocked *by default*. With "Allow
  // access to file URLs" on, the debugger attaches, so refusing unconditionally
  // would fail closed against this module's own policy and would put a bogus
  // `file-url` entry in the capability split for a dogfooder whose setup is
  // fine. The caller supplies the answer (`isAllowedFileSchemeAccess`), which
  // this module cannot read without taking a chrome dependency.
  if (scheme === "file:") {
    return opts.fileAccess ? ATTACHABLE : blockedBy("file-url");
  }

  // Every browser's own UI scheme, not just Chrome's: the dogfood build loads
  // unpacked in Chromium forks too, and `edge://settings` is as blocked there
  // as `chrome://settings` is here.
  if (
    scheme === "chrome:" ||
    scheme === "chrome-untrusted:" ||
    scheme === "devtools:" ||
    scheme === "edge:" ||
    scheme === "brave:" ||
    scheme === "opera:" ||
    scheme === "vivaldi:"
  ) {
    return blockedBy("browser-ui");
  }
  if (scheme === "chrome-extension:" || scheme === "moz-extension:") {
    return blockedBy("extension-page");
  }

  const host = parsed.hostname.toLowerCase();
  const isWebStore =
    host === "chromewebstore.google.com" ||
    (host === "chrome.google.com" && parsed.pathname.startsWith("/webstore"));
  if (isWebStore) return blockedBy("web-store");

  return ATTACHABLE;
}

/**
 * Post-hoc: turn an attach outcome's error tag into a reason.
 *
 * `conflict` is the one worth naming precisely — it is the only reason in the
 * set that is **transient and user-fixable** (close DevTools), and it is one of
 * the three headline questions the dogfood exists to measure, so it must never
 * be blurred into the generic refusal.
 */
export function classifyAttachError(
  error: string | undefined,
): NativeUnavailableReason {
  return error === "conflict" ? "devtools-conflict" : "attach-refused";
}

/**
 * One sentence for the user: what happened, and what to do about it.
 *
 * Where the content script still works (a DevTools conflict, an unexplained
 * refusal), the TAB view, which reads the page through it, still lists the
 * tab order: say so. Where Chrome blocks every extension surface, say that
 * instead.
 */
export function explainUnavailable(reason: NativeUnavailableReason): string {
  switch (reason) {
    case "browser-ui":
      return "native can't attach to browser UI pages — Chrome blocks extensions here entirely. Try a normal web page.";
    case "extension-page":
      return "native can't attach to extension pages — Chrome blocks extensions from each other. Try a normal web page.";
    case "web-store":
      return "native can't attach to the Chrome Web Store — Chrome blocks all extension access there.";
    case "view-source":
      return "view-source: has no attachable document. Open the page itself.";
    case "file-url":
      return 'native can\'t attach to file:// URLs without "Allow access to file URLs" (chrome://extensions → this extension → Details).';
    case "no-url":
      return "couldn't read this tab's URL — it has probably gone away. Try again, or switch to a tab that is still open.";
    case "devtools-conflict":
      return "DevTools is attached to this tab, and Chrome allows only one debugger client at a time. Close DevTools (or undock it onto another tab) and refresh — the TAB view still lists the tab order meanwhile.";
    case "attach-refused":
      return "Chrome refused the debugger attach on this tab. Refresh to try again — the TAB view still lists the tab order meanwhile.";
  }
}
