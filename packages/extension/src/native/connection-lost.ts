/**
 * Messages Chrome produces when the debuggee itself went away mid-command — a
 * genuine connection drop (MV3 suspend, forced detach, tab closed), as opposed
 * to a CDP command that merely failed.
 *
 * The classification is deliberately **conservative**: anything unrecognized
 * counts as a command failure, not a drop. `reattach-*` is the dogfood's
 * headline lifecycle metric, so over-tagging would inflate the number the
 * ship/no-ship decision rests on — better to undercount than to invent drops.
 * The message is only inspected here and never surfaced (R6).
 *
 * A module of its own so `native-core.ts`, which the side panel loads too, can
 * tell a drop apart without loading `debugger-session.ts`.
 */
export function isConnectionLost(message: string | undefined): boolean {
  // `no (target|tab) with given id` — Chrome phrases this per target type, and
  // the `{ tabId }` form `debugger-session.ts` always uses yields the TAB
  // wording ("No tab with given id 7."). Matching only the `target` spelling
  // meant a closed tab fell through to the "plausibly still attached" branch in
  // `detachIfLive`, which puts the entry back: the map then never cleared and
  // every later revoke re-reported the same dead tab as `detach-refused`.
  return /detached|not attached|target closed|no (?:target|tab) with given id|tab was closed/i.test(
    message ?? "",
  );
}
