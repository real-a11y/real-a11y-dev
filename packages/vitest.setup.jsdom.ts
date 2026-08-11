// Shared jsdom setup for every package whose tests render Preact components.
//
// Preact's hook scheduler (10.29.x) queues effect flushing through
// `requestAnimationFrame` and cancels via `cancelAnimationFrame`. Under
// vitest + jsdom a still-pending scheduler callback can fire *after* the jsdom
// environment has been torn down, in a bare Node context where those globals no
// longer exist — throwing `ReferenceError: cancelAnimationFrame is not defined`
// and failing an otherwise-passing run (flaky, timing-dependent — it surfaces
// only on CI, and in practice only on the slower macOS runners).
//
// Install deterministic `setTimeout`-backed implementations, which fire on the
// next tick instead of Preact's ~100ms `requestAnimationFrame` fallback — so in
// practice the scheduler has drained long before a suite finishes.
//
// This narrows the window rather than closing it absolutely. Vitest deletes
// `requestAnimationFrame`/`cancelAnimationFrame` from the global on jsdom
// teardown but leaves `setTimeout` as Node's, so a timer this shim scheduled can
// still outlive teardown and reach a `cancelAnimationFrame` that is gone by
// then. Making that airtight would mean tracking and clearing pending ids in an
// `afterEach`, which is more machinery than the flake has warranted so far.
//
// This lives at the repo root rather than in one package because the exposure
// is not package-specific: it belongs to Preact's scheduler, so every jsdom
// suite that renders a component has it. It was originally fixed in `ui` alone,
// which left `inspector`, `react`, `storybook-addon` and `extension` to hit the
// same flake later — one copy, referenced by all of them, is what stops that
// recurring.
const raf = (cb: FrameRequestCallback): number =>
  setTimeout(() => cb(Date.now()), 0) as unknown as number;
const caf = (id: number): void => clearTimeout(id);

globalThis.requestAnimationFrame = raf;
globalThis.cancelAnimationFrame = caf;
