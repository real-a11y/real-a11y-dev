# Extension native mode — `chrome.debugger` dogfood

**Status:** dev-only · **RFC:** [`docs/rfcs/native-tree-v3.md`](../../docs/rfcs/native-tree.md) (Revision 1 + PR H) · not for the Chrome Web Store.

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
  its own manifest that adds `debugger` + `tabs`. Unpacked extensions need no
  store review. It is never submitted.

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
4. Use it across normal sessions for ~2 weeks. Leave DevTools open sometimes.

Everything is instrumented to `chrome.storage.local` (content-free — event kinds,
timings, counts; never page text or typed values).

## Report back

**Copy dogfood report** puts a summary + raw log on your clipboard. Paste it into
the RFC PR H thread. The three questions it answers:

- **Banner tolerance** — attach count + total time attached. Did the banner
  actually bother you during deliberate audit sessions?
- **MV3 service-worker lifecycle** — unsolicited detaches (the worker suspending
  drops the debugger) and whether reattach recovered. _This is the main
  engineering risk._
- **DevTools conflict** — how often attach was refused because DevTools (or
  another debugger) held the tab.

Add your qualitative read alongside the numbers. That verdict decides whether
extension-native ships (and, per the RFC, whether the Electron desktop shell is
ever built).
