/**
 * The follow window: the few seconds after the user acts, by sending an
 * action or a key through the tree or by clicking or pressing a key on the
 * page itself, in which the page's changes are what the user did, and are
 * read whatever the mode ({@link ACTION_FOLLOW_MS}).
 *
 * This module keeps the window's bookkeeping, as pure transitions: `App.tsx`
 * holds the state and calls them as things happen, and `decideAutoRefresh`
 * decides from the result.
 */

import { ACTION_FOLLOW_MS } from "./native-auto-refresh.js";

/** @internal */
export interface FollowWindow {
  /** A change dated after `from` and before `until`, in ms, is what the
   *  user did. `until` is 0 when no window is open. */
  from: number;
  until: number;
  /** A followed change dated before this is an action's, sent through the
   *  tree, and read at once; one after it is a click's on the page, read
   *  no closer than the minimum gap to the read before. */
  actionUntil: number;
  /** The window a click on the page closed by opening another: a change
   *  made in it and reported late is still followed. */
  previousFrom: number;
  previousUntil: number;
  /** When the earliest followed change no read has seen yet was made, in
   *  ms, or `Infinity`. */
  firstChangeAt: number;
  /** A navigation started in the window, so the page it leads to is
   *  followed the same way from its first read: as an action's when it
   *  started in an action's part. Set at `destinationAt`, in ms. */
  destination: "action" | "input" | null;
  destinationAt: number;
  /** When the user last typed on the page, in ms, or 0. */
  typedAt: number;
}

/** No window, and nothing followed.
 *
 * @internal */
export const NOT_FOLLOWING: FollowWindow = {
  from: 0,
  until: 0,
  actionUntil: 0,
  previousFrom: 0,
  previousUntil: 0,
  firstChangeAt: Infinity,
  destination: null,
  destinationAt: 0,
  typedAt: 0,
};

/** Whether a change dated `at` is what the user did.
 *
 * @internal */
export function isFollowed(w: FollowWindow, at: number): boolean {
  return (
    (at > w.from && at < w.until) ||
    (at > w.previousFrom && at < w.previousUntil)
  );
}

/** A change dated `at` was heard of, which no read has seen yet.
 *
 * @internal */
export function followChange(w: FollowWindow, at: number): FollowWindow {
  if (!isFollowed(w, at) || at >= w.firstChangeAt) return w;
  return { ...w, firstChangeAt: at };
}

/** A read started: it sees every change made before it.
 *
 * @internal */
export function followReadStarted(w: FollowWindow): FollowWindow {
  return w.firstChangeAt === Infinity ? w : { ...w, firstChangeAt: Infinity };
}

/**
 * A read the user caused ended at `now`, having started at `readStartedAt`:
 * an action's or a sent key's own re-read (`"action"`), or the first read
 * of the page a navigation in the window led to (as its `destination`). It
 * saw every change made before it started, so the window starts there, and
 * every change since (the earliest at `firstUnreadChangeAt`) is followed:
 * until the user typed, if they did while it ran (`followTyping`).
 *
 * @internal
 */
export function followAfterRead(
  w: FollowWindow,
  as: "action" | "input",
  readStartedAt: number,
  firstUnreadChangeAt: number,
  now: number,
): FollowWindow {
  // Bounded, should the clock have stepped back since the typing.
  const until = Math.min(
    w.typedAt > readStartedAt ? w.typedAt : Infinity,
    now + ACTION_FOLLOW_MS,
  );
  return {
    ...w,
    from: readStartedAt,
    until,
    actionUntil: as === "action" ? until : w.actionUntil,
    previousFrom: 0,
    previousUntil: 0,
    firstChangeAt: firstUnreadChangeAt < until ? firstUnreadChangeAt : Infinity,
  };
}

/**
 * The user clicked or pressed a key on the page at `now`, the latest change
 * heard of being dated `lastChangeAt`. Nothing reads the page for it, so
 * the changes already heard of were made before it, and aren't its own: a
 * window it opens starts after them, keeping the one it closes for that
 * one's changes reported late, and anything followed stays followed. A
 * window already open is only stretched.
 *
 * @internal
 */
export function followPageInput(
  w: FollowWindow,
  lastChangeAt: number,
  now: number,
): FollowWindow {
  const until = now + ACTION_FOLLOW_MS;
  if (w.until > now) return { ...w, until: Math.max(w.until, until) };
  return {
    ...w,
    from: lastChangeAt,
    until,
    previousFrom: w.from,
    previousUntil: w.until,
  };
}

/**
 * The user typed on the page at `at`, by the clock its changes are dated
 * by. What they type isn't what a click or an action did, and reading it
 * would bring Chrome's bar up as they type, so a window open then ends
 * there, a change made before it still followed. A window opened after
 * it, by a click, is left alone; one a read opens ends where the typing was
 * if the user typed while it ran (`followAfterRead`), and the page a
 * navigation led to isn't followed if they typed there before its first
 * read (`followDestination`).
 *
 * @internal
 */
export function followTyping(w: FollowWindow, at: number): FollowWindow {
  const ends = (end: number) => (at > w.from && at < end ? at : end);
  return {
    ...w,
    until: ends(w.until),
    actionUntil: ends(w.actionUntil),
    typedAt: Math.max(w.typedAt, at),
  };
}

/**
 * The page navigated at `now`. The window closes, and the page it leads to
 * is followed once read if the navigation started in it, most likely what
 * the user did. A destination already set is kept as a redirect would be,
 * the same navigation going on: within {@link ACTION_FOLLOW_MS} of the hop
 * before, and only if the user hasn't typed since, on the page between.
 * One that never committed (a download) is let go of that way too.
 *
 * @internal
 */
export function followNavigation(w: FollowWindow, now: number): FollowWindow {
  const kept =
    w.destination !== null &&
    now - w.destinationAt < ACTION_FOLLOW_MS &&
    w.typedAt === 0
      ? w.destination
      : null;
  const destination =
    now < w.actionUntil ? "action" : now < w.until ? (kept ?? "input") : kept;
  return destination === null
    ? NOT_FOLLOWING
    : { ...NOT_FOLLOWING, destination, destinationAt: now };
}

/** The first read of another page ended at `now`, having started at
 *  `readStartedAt`: follow it if a navigation in the window led to it, and
 *  the user hasn't typed there since.
 *
 *  @internal */
export function followDestination(
  w: FollowWindow,
  readStartedAt: number,
  firstUnreadChangeAt: number,
  now: number,
): FollowWindow {
  if (w.destination === null) return w;
  // Typed since the navigation (which set `typedAt` back to 0), before the
  // read began.
  if (w.typedAt !== 0 && w.typedAt <= readStartedAt) {
    return { ...w, destination: null };
  }
  return {
    ...followAfterRead(
      w,
      w.destination,
      readStartedAt,
      firstUnreadChangeAt,
      now,
    ),
    destination: null,
  };
}
