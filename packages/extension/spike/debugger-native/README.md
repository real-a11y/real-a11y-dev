# Extension `chrome.debugger` native tree — Spike 5

**Status:** Spike · **RFC:** [`docs/rfcs/native-tree-v3.md`](../../../../docs/rfcs/native-tree-v3.md) (ordering question) · [`docs/rfcs/native-tree-spike.md`](../../../../docs/rfcs/native-tree-spike.md) § Spike 5
**Run:** `pnpm --filter @real-a11y-dev/semantic-navigator-extension run test:spike`

## Question

v3 parked extension-native at "Phase 6, only with demand," mostly on the
debugger-banner tax. Is that ordering right — or can the extension consume the
native tree cheaply enough that the Desktop app's Electron shell may never be
needed?

## What it proves

| Claim | Result |
|---|---|
| MV3 service worker reads `Accessibility.getFullAXTree` via `chrome.debugger` | **Yes** — UA-shadow media controls (`button "play"`, scrubber, mute…) visible from the extension, which the content script (DOM producer) can never see |
| Action dispatch through the tree over `chrome.debugger` | **Yes** — `backendDOMNodeId → DOM.resolveNode → Runtime.callFunctionOn`, counter task completed, `role=status` change read back through the tree |
| The "third CDP transport" tax is avoidable | **Yes, by construction** — `native-core.ts` is written against a 1-method `CdpTransport` interface; the test runs the *same module* over `chrome.debugger.sendCommand` (in the worker) and Playwright's `CDPSession` (in Node) and asserts **identical** serialized output |
| Debugger exclusivity is real | **Confirmed** — second attach fails with `"Another debugger is already attached to the tab with id: …"`; this is the DevTools-conflict failure class. Nuance: Playwright's pipe-level CDP client coexisted with `chrome.debugger` fine — exclusivity is per-tab among debugger-class clients (DevTools, other extensions), not all CDP consumers |
| §5.4 name drift reproduces here too | The authored `aria-label="Product tour"` is replaced by the load-state name `"Unable to play media."` — same normalizer work, regardless of surface |

## What it deliberately does NOT answer (the remaining product gates)

- **Banner UX** — headless CI can't see the "…is debugging this browser"
  infobar. Needs a headed dogfood run: does it annoy during *deliberate* audit
  sessions? (v3's revised bet: probably not.)
- **MV3 service-worker lifecycle** — the test session is seconds long; a real
  session must survive SW suspension (detach/reattach on wake, keepalive
  strategy). This is the main engineering risk left.
- **DevTools mutual exclusion in practice** — mechanically confirmed above;
  how often it bites real users (who live in DevTools) is a dogfood question.

## Layout

```
native-core.ts   transport-agnostic: normalize + readNativeTree + clickByBackendId
                 (vocabulary is the THIRD copy in tree — v3 finding R4; product
                  code must import the one versioned module from `browser`)
sw.ts            chrome.debugger plumbing only — the entire surface a product
                 "native mode" adds to the extension
manifest.json    MV3, permissions: ["debugger", "tabs"]
fixture.html     video + counter task
*.spike.test.ts  bundles sw via vite → loads extension in full Chromium
                 (new headless, "chromium" channel — extensions don't load in
                 the headless shell) → drives the worker via sw.evaluate
```

## Consequence for the RFC

Feasibility is no longer the question. Extension-native is promoted from
"Phase 6, with demand" to a **Phase-1-adjacent product decision** gated on the
two dogfood questions above — and the Electron desktop shell (v3 §4.5 step 2)
is **gated on that outcome**. See the revision note in `native-tree-v3.md`.
