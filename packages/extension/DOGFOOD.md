# Extension native mode — `chrome.debugger` dogfood

**Status:** dev-only · **RFC:** [native-tree RFC (#197)](https://github.com/real-a11y/real-a11y-dev/pull/197) (Revision 2 + PR H) · not for the Chrome Web Store.

This is the time-boxed dogfood the native-tree RFC gates the desktop decision on.
Spike 5 already proved the mechanism works (an MV3 service worker reads **and**
dispatches Chromium's native accessibility tree — UA-shadow media controls
included — over `chrome.debugger`). What it **could not** answer needs a real,
headed, human session. This build instruments exactly those three questions.

> **It produces a decision, not a feature.** The goal is a verdict written back
> into the RFC, not shipping native mode to store users.

## Why it's a separate build

`chrome.debugger` is one of Chrome's most sensitive permissions. Requesting it
in the **published** extension would trigger heightened store review, a scary
permission warning, and a forced re-consent for every existing user — for a
feature that's off by default. So the store build never carries it:

- `packages/extension/public/manifest.json` (the **shipped** manifest) stays
  clean: `activeTab`, `sidePanel`, `webNavigation`.
- The native code is gated behind a build-time `__DOGFOOD__` constant, so it is
  **dead-code-eliminated** from the store build (verified: the production
  `background.js` contains no `chrome.debugger` reference).
- The dogfood build is a **separate, unpacked** artifact (`dist-dogfood/`) with
  its own manifest that adds `debugger` + `tabs` + `storage` (the last for the
  content-free instrumentation log). Unpacked extensions need no store review.
  It is never submitted.

## Build & load

```sh
pnpm --filter @real-a11y-dev/semantic-navigator-extension build:dogfood
```

Then in Chrome:

1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select `packages/extension/dist-dogfood/`.
3. It appears as **"Semantic Navigator (native dogfood)"** — distinct from the
   store version, so you can tell them apart.

## Run the dogfood

Open the side panel on a real page you actually use (one with a `<video controls>`
is a good test — its media controls are the thing only native mode can see).

1. Expand **"⚠︎ chrome.debugger native mode — DEV dogfood"** at the top of the panel.
2. Tick **native mode** (this is the runtime flag — the `debugger` capability is
   still inert until you do this).
3. **Load native tree** — attaches the debugger (you'll see Chrome's
   "…is debugging this browser" banner), reads the tree, and lists it. Interactive
   rows are buttons; click one to dispatch a click (or type into a text field).
   The tree **re-reads itself after every successful action**, so the ids stay
   valid for the next one — you should not need to reload by hand between
   clicks. If you navigate the page, or switch tabs, the panel drops the tree
   and says so rather than dispatching against ids the document no longer has.
   The re-read waits a short beat for the page to react, which covers batching
   and menu transitions but **not** a slow fetch-driven re-render — if a click
   ever seems to act on the previous state of the page, that is the case to
   note, and re-reading by hand will confirm it.
4. **On a page native can't reach**, the panel names the reason instead of
   reporting a bare failure. Two different moments, because they are two
   different kinds of answer:
   - **Before attaching**, from the URL alone — a `chrome://` tab, the Web
     Store, an extension page, `view-source:`, or a `file://` URL without
     "Allow access to file URLs". These can't change until you navigate, so
     **Load native tree** is disabled and no banner ever flashes.
   - **On the attach**, for anything the URL can't predict — most importantly
     **DevTools holding the tab**. The button stays live for these: the remedy
     is "close DevTools and try again", and disabling it would put that remedy
     out of reach.

   Where the DOM producer still works (a DevTools conflict), the message points
   you at it; where Chrome blocks every extension surface (`chrome://`, the Web
   Store), it says _that_ rather than sending you to a panel which will also
   never load.

5. **Switching native mode off detaches.** `debugger` cannot be an optional
   permission, so "revoked" can only mean "not attached" — unticking the box
   drops any live attachment and reports how many tabs it detached from. Normally
   that is zero; a non-zero count means an MV3 suspend had stranded an attachment
   (and its banner), which is worth noting in your report.
6. Use it across normal sessions for ~2 weeks. Leave DevTools open sometimes.

Everything is instrumented to `chrome.storage.local` (content-free — event kinds,
timings, counts; never page text or typed values).

## Report back

**Copy dogfood report** puts a summary + raw log on your clipboard. Paste it into
the RFC PR H thread. The RFC's three questions, plus the one that frames them:

- **Banner tolerance** — attach count + total time attached. Did the banner
  actually bother you during deliberate audit sessions?
- **MV3 service-worker lifecycle** — unsolicited detaches (the worker suspending
  drops the debugger) and whether reattach recovered. _This is the main
  engineering risk._ Both numbers are deliberately narrow: attach bookkeeping
  lives in `chrome.storage.session`, so a detach still gets attributed after the
  suspend that destroyed the worker's memory; and only a genuine dropped
  connection counts as a reattach — a CDP command that merely failed, or a page
  the debugger can never attach to (`chrome://`, the Web Store), does not.
- **DevTools conflict** — how often attach was refused because DevTools (or
  another debugger) held the tab.
- **Capability** — how often native was unavailable at all, split by reason.
  This is the fourth number and it reframes the other three: a run that is mostly
  `devtools-conflict` says the problem is conflict handling, while one that is
  mostly `browser-ui` says users simply spend their time on pages native can
  never reach — and no amount of engineering changes that. The split is kept as
  an uncapped counter, so it stays true after the raw log rolls.

Add your qualitative read alongside the numbers. That verdict decides whether
extension-native ships (and, per the RFC, whether the Electron desktop shell is
ever built).
