/**
 * Can native mode work on this tab, and if not, what should we say?
 *
 * Native reads Chromium's tree over `chrome.debugger`, which Chrome forbids on
 * a set of privileged pages. Session 1 surfaced every one of those as a bare
 * `attach-failed`, which reads as a bug in the extension rather than a platform
 * rule — and each attempt still flashed the "…is debugging this browser" banner
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
  /**
   * The DOM content-script producer works here, so the panel below is a real
   * fallback rather than a second dead end.
   *
   * This is NOT the negation of `native`. On `chrome://`, the Web Store and
   * extension pages Chrome blocks *all* extension access, so the content script
   * is just as dead — and telling a dogfooder to "use the DOM tree instead"
   * there sends them to a panel that will also never load (the failure #0.1.12
   * was about). Only a DevTools conflict, an unreadable URL, or an unexplained
   * refusal leave the DOM producer genuinely working.
   */
  domFallback: boolean;
  /**
   * Trying again on this same tab could succeed, so the panel must keep the
   * controls live.
   *
   * A DevTools conflict is the case this exists for: it is the one reason the
   * remedy is "close DevTools and try again", and disabling the button on it
   * makes that remedy unreachable — the user closes DevTools and has no way to
   * ask again short of switching tabs. Structural refusals (`chrome://`, the
   * Web Store) stay true until the tab navigates, which re-runs the pre-flight
   * on its own.
   */
  retryable: boolean;
}

const ATTACHABLE: TabCapability = {
  native: true,
  domFallback: true,
  retryable: true,
};

/**
 * Whether the DOM content-script producer still works, per reason — the single
 * source of truth for {@link TabCapability.domFallback}.
 *
 * `false` here means Chrome blocks *every* extension surface on that page, so
 * the content script is as dead as the debugger. Getting this wrong in the
 * optimistic direction is the expensive mistake: it sends a dogfooder to a
 * panel that will sit on "Connecting to page…" forever and reads as a second
 * bug rather than the same platform rule.
 */
const DOM_FALLBACK: Record<NativeUnavailableReason, boolean> = {
  "browser-ui": false,
  "extension-page": false,
  "web-store": false,
  "view-source": false,
  // Both producers need "Allow access to file URLs"; neither has it by default.
  "file-url": false,
  "no-url": true,
  "devtools-conflict": true,
  "attach-refused": true,
};

/**
 * Whether asking again on the same tab could give a different answer — the
 * single source of truth for {@link TabCapability.retryable}.
 *
 * The three `true` entries are the ones that depend on something outside the
 * URL: another client holding the tab, a tab we could not read, and a refusal
 * Chrome did not explain. Everything else is a property of the address itself
 * and cannot change without a navigation.
 */
const RETRYABLE: Record<NativeUnavailableReason, boolean> = {
  "browser-ui": false,
  "extension-page": false,
  "web-store": false,
  "view-source": false,
  // Turning on "Allow access to file URLs" changes this answer, but only via a
  // settings page — not by pressing the button again, and the extension is
  // reloaded when it changes.
  "file-url": false,
  "no-url": true,
  "devtools-conflict": true,
  "attach-refused": true,
};

/** The capability a refusal implies, from the reason alone. Used by the panel
 *  for a reason that arrived over messaging, where the URL is not in hand. */
export function blockedBy(reason: NativeUnavailableReason): TabCapability {
  return {
    native: false,
    reason,
    domFallback: DOM_FALLBACK[reason],
    retryable: RETRYABLE[reason],
  };
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
  if (!url) return blockedBy("no-url");

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
    const rest = url.slice("about:".length).toLowerCase();
    return rest === "blank" || rest === "srcdoc"
      ? ATTACHABLE
      : blockedBy("browser-ui");
  }
  if (scheme === "view-source:") return blockedBy("view-source");
  // `file://` is not blocked outright — it is blocked *by default*. With "Allow
  // access to file URLs" on, both producers work, so refusing unconditionally
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
 * One sentence for a dogfooder: what happened, and what to do about it.
 *
 * Where the DOM producer still works, say so — that is the "fallback" half of
 * the capability story. Where it doesn't, say *that* instead of pointing at a
 * panel which will sit on "Connecting to page…" forever.
 */
export function explainUnavailable(reason: NativeUnavailableReason): string {
  switch (reason) {
    case "browser-ui":
      return "native can't attach to browser UI pages — and neither can the DOM producer; Chrome blocks extensions here entirely. Try a normal web page.";
    case "extension-page":
      return "native can't attach to extension pages — Chrome blocks extensions from each other. Try a normal web page.";
    case "web-store":
      return "native can't attach to the Chrome Web Store — Chrome blocks all extension access there, the DOM producer included.";
    case "view-source":
      return "view-source: has no attachable document. Open the page itself.";
    case "file-url":
      return 'native can\'t attach to file:// URLs without "Allow access to file URLs" (chrome://extensions → this extension → Details). The DOM producer needs the same switch.';
    case "no-url":
      return "couldn't read this tab's URL, so native can't tell whether it can attach. The DOM tree below should still work.";
    case "devtools-conflict":
      return "DevTools is attached to this tab, and Chrome allows only one debugger client at a time. Close DevTools (or undock it onto another tab) and try again — the DOM tree below works meanwhile.";
    case "attach-refused":
      return "Chrome refused the debugger attach on this tab. The DOM tree below should still work.";
  }
}
