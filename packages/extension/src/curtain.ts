/**
 * The screen curtain: one element over the whole page, so the page is
 * navigated through the panel and not seen.
 *
 * No z-index keeps an element above everything a page paints. An element of
 * the page's at the same z-index goes over it, and so does anything in the
 * top layer: an open popover, a modal `<dialog>`, a fullscreen element, as a
 * site's search suggestions often are. So the curtain is a popover itself,
 * shown, which puts it in the top layer, above every z-index. In the top
 * layer what entered last is on top, so the curtain enters it again after
 * anything the page shows there (`raiseSoon`):
 *
 *  - before the next frame paints, for a popover or dialog the window hears
 *    a `beforetoggle` from, and for a fullscreen element;
 *  - at the next visibility check, within about 100ms, for one it doesn't
 *    hear: a popover in a shadow root, whose `beforetoggle` stops at that
 *    root. An `IntersectionObserver` that tracks visibility reports the
 *    curtain covered.
 *
 * Raising it fires its own toggle events, which stop at the window, so the
 * page's listeners don't hear them. A script that keeps something of its own
 * on top the same way could otherwise answer each raise with its own, every
 * frame for good; and one that hears them anyway can make the curtain trade
 * places at most `MAX_RAISES_PER_SECOND` times a second, after which it waits
 * out the second and goes on top again.
 *
 * Above a page's modal dialog the curtain is inert, as everything outside the
 * dialog is, and hit testing passes it by, so a press on it would land on the
 * hidden dialog. So a stylesheet inside it takes every element of the page's
 * out of hit testing while it is up (`pointer-events: none`), and a press
 * reaches nothing of the page's. Only a pointer is hit tested: a screen
 * reader's click, and the extension's own actions, go to their element as
 * before, and Chrome's tree is the same.
 *
 * Its inline style resets every property and sets each one it needs, all
 * `!important`, so that no rule of the page's moves, shrinks or thins it: a
 * page that styles `[popover]` styles the curtain too.
 *
 * Where the browser has no popovers, the curtain has the highest z-index
 * there is, last in the document's root element, as it always had.
 *
 * It is `aria-hidden`, so Chrome's tree, which the panel shows while it is
 * up, leaves it out as the extension's in-page walk does: its words aren't
 * the page's, and a shown popover is a `group` there.
 */

/** Starts `__sn-`, which marks it as one of the extension's own elements:
 *  see `isOwnElementId` in `native/page-keys.ts`. */
const CURTAIN_ID = "__sn-curtain";

const CURTAIN_STYLE = [
  // First, so that each declaration after it wins over it. It also puts the
  // curtain back in hit testing, which its stylesheet takes everything out of.
  "all: initial",
  "position: fixed",
  "inset: 0",
  "z-index: 2147483647",
  "display: flex",
  "flex-direction: column",
  "align-items: center",
  "justify-content: center",
  "gap: 8px",
  "background: #0f172a",
  "color: #94a3b8",
  "font: 16px/1.5 system-ui, sans-serif",
]
  .map((declaration) => `${declaration} !important;`)
  .join(" ");

const CURTAIN_HTML = `
  <style>*, ::backdrop { pointer-events: none !important; }</style>
  <div style="font-size:24px;font-weight:700;color:#e2e8f0">Screen Curtain</div>
  <div>Content hidden — navigate via Semantic Navigator</div>
`;

/** How often, at least, the visibility check runs: Chrome's floor for an
 *  observer that tracks visibility. */
const COVER_CHECK_MS = 100;

/** More than anything a page shows on its own: two raises for each popover,
 *  ten popovers a second. */
const MAX_RAISES_PER_SECOND = 20;

/** The curtain kept at the top of the top layer, while it is up. */
let kept: HTMLElement | null = null;
/** Reports `kept` covered: see the module comment. */
let coverWatch: IntersectionObserver | null = null;
/** Whether a raise waits for the script that asked it to finish. */
let raiseAfterScript = false;
/** The frame callback that raises `kept`, while one is asked for. */
let raiseFrame = 0;
/** When `kept` was raised in the last second, oldest first. */
let raisedAt: number[] = [];
/** The raise put off for `MAX_RAISES_PER_SECOND`, while one is. */
let raiseLater: ReturnType<typeof setTimeout> | undefined;

/** Draw the curtain over the document `root` is the root element of, unless
 *  it is there already, and put it on top. */
export function showCurtain(root: Element): void {
  const doc = root.ownerDocument;
  const popovers =
    typeof (root as Partial<HTMLElement>).showPopover === "function";
  let curtain = doc.getElementById(CURTAIN_ID);
  // One an older version of the extension's script left, which a page's
  // popover covers: this one takes its place.
  if (curtain && popovers && !curtain.hasAttribute("popover")) {
    curtain.remove();
    curtain = null;
  }
  if (!curtain) {
    curtain = doc.createElement("div");
    curtain.id = CURTAIN_ID;
    curtain.setAttribute("aria-hidden", "true");
    curtain.style.cssText = CURTAIN_STYLE;
    curtain.innerHTML = CURTAIN_HTML;
    if (popovers) curtain.setAttribute("popover", "manual");
    root.appendChild(curtain);
  }
  if (!curtain.hasAttribute("popover")) return;
  keepOnTop(curtain);
  raiseKept();
}

/** Take the curtain out of the document, and stop keeping it on top. */
export function liftCurtain(doc: Document): void {
  doc.getElementById(CURTAIN_ID)?.remove();
  removeEventListener("beforetoggle", onToggle, true);
  removeEventListener("toggle", onToggle, true);
  removeEventListener("fullscreenchange", raiseSoon, true);
  coverWatch?.disconnect();
  coverWatch = null;
  kept = null;
  if (raiseFrame) cancelAnimationFrame(raiseFrame);
  raiseFrame = 0;
  clearTimeout(raiseLater);
  raiseLater = undefined;
  raisedAt = [];
}

/** Raise `curtain` after anything the page shows in the top layer from now
 *  on. Again for the same curtain changes nothing, but adds the listeners
 *  back after a `document.open()`, which takes them off the window. */
function keepOnTop(curtain: HTMLElement): void {
  // On the window's capture phase, so that the page's handlers can't stop
  // one before this one hears it, nor hear the curtain's own, unless one went
  // on that phase first.
  addEventListener("beforetoggle", onToggle, true);
  addEventListener("toggle", onToggle, true);
  // A fullscreenchange goes either way, and raising the curtain when one ends
  // does no harm.
  addEventListener("fullscreenchange", raiseSoon, true);
  if (kept === curtain) return;
  kept = curtain;
  coverWatch?.disconnect();
  coverWatch = newCoverWatch();
  coverWatch?.observe(curtain);
}

/** The curtain's own toggle events stop here. A popover or dialog of the
 *  page's about to show raises the curtain over it. */
function onToggle(e: Event): void {
  if (!kept) return;
  if (e.target === kept) {
    e.stopImmediatePropagation();
    return;
  }
  if (e.type === "beforetoggle" && (e as ToggleEvent).newState === "open") {
    raiseSoon();
  }
}

/**
 * Raise the curtain once what is showing has entered the top layer, before a
 * frame paints it there. Twice over, since neither time is right for both:
 *
 *  - once the script that showed it has run, which is when it has entered:
 *    that is before the frame paints even when the script is a frame
 *    callback, which a frame callback asked for now would only follow in the
 *    next frame;
 *  - in the next frame's callbacks, for one the browser shows itself, from a
 *    `popovertarget` button: no script of the page's runs then, so the first
 *    raise comes before it enters.
 */
function raiseSoon(): void {
  if (!raiseAfterScript) {
    raiseAfterScript = true;
    queueMicrotask(() => {
      raiseAfterScript = false;
      raiseKept();
    });
  }
  if (!raiseFrame) {
    raiseFrame = requestAnimationFrame(() => {
      raiseFrame = 0;
      raiseKept();
    });
  }
}

/** Put the curtain at the top of the top layer: out of it and in again, in
 *  one task, so that no frame paints it out. At most `MAX_RAISES_PER_SECOND`
 *  times a second; past that, once the second is out. */
function raiseKept(): void {
  if (!kept) return;
  const now = Date.now();
  raisedAt = raisedAt.filter((at) => now - at < 1000);
  if (raisedAt.length >= MAX_RAISES_PER_SECOND) {
    raiseLater ??= setTimeout(
      () => {
        raiseLater = undefined;
        raiseKept();
      },
      1000 - (now - raisedAt[0]!),
    );
    return;
  }
  raisedAt.push(now);
  try {
    kept.hidePopover();
    kept.showPopover();
  } catch {
    // Out of the document: the root element was swapped, and the next draw
    // shows another curtain. Or the page took its `popover` attribute off,
    // which leaves it the z-index.
  }
}

/** Visibility tracking, which TypeScript's DOM types don't carry yet. */
interface VisibilityInit extends IntersectionObserverInit {
  trackVisibility: boolean;
  delay: number;
}

/** An observer that raises the curtain whenever it finds it covered, or null
 *  where there is none. A browser that can't tell never reports it covered. */
function newCoverWatch(): IntersectionObserver | null {
  if (typeof IntersectionObserver !== "function") return null;
  const init: VisibilityInit = { trackVisibility: true, delay: COVER_CHECK_MS };
  return new IntersectionObserver((entries) => {
    const covered = entries.some(
      (entry) => (entry as { isVisible?: boolean }).isVisible === false,
    );
    if (covered) raiseSoon();
  }, init);
}
