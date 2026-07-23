// Preact's hook scheduler (10.29.x) queues effect flushing through
// `requestAnimationFrame` and cancels via `cancelAnimationFrame`. Under
// vitest + jsdom a still-pending scheduler callback can fire *after* the jsdom
// environment has been torn down, in a bare Node context where those globals no
// longer exist — throwing `ReferenceError: cancelAnimationFrame is not defined`
// and failing an otherwise-passing run (flaky, timing-dependent — it surfaced
// only on CI). Install deterministic `setTimeout`-backed implementations so a
// late callback is always a harmless no-op regardless of teardown ordering.
const raf = (cb: FrameRequestCallback): number =>
  setTimeout(() => cb(Date.now()), 0) as unknown as number;
const caf = (id: number): void => clearTimeout(id);

globalThis.requestAnimationFrame = raf;
globalThis.cancelAnimationFrame = caf;
