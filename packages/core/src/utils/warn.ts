/**
 * `console.warn`, except in production.
 *
 * For a degradation the engine recovers from on its own — skipping an element
 * it cannot read, or falling back to a full extraction — where the recovery is
 * the right runtime behavior but the gap should stay debuggable. Gated off in
 * production to avoid console noise; this package has no `@types/node`, so
 * `process` is reached through a `globalThis` cast.
 */
export function warnOutsideProduction(...details: unknown[]): void {
  const proc = (globalThis as { process?: { env?: { NODE_ENV?: string } } })
    .process;
  if (proc?.env?.NODE_ENV === "production") return;
  if (typeof console !== "undefined") console.warn(...details);
}
