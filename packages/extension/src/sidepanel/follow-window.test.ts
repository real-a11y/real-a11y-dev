import { describe, expect, it } from "vitest";

import {
  followAfterRead,
  followChange,
  followDestination,
  followNavigation,
  followPageInput,
  followReadStarted,
  followTyping,
  isFollowed,
  NOT_FOLLOWING,
  type FollowWindow,
} from "./follow-window.js";
import { ACTION_FOLLOW_MS } from "./native-auto-refresh.js";

const NOW = 100_000;

/** The window a click on the page opened at `at`, after a change heard of
 *  dated `heard`. */
function clicked(at: number, heard = at - 2000): FollowWindow {
  return followPageInput(NOT_FOLLOWING, heard, at);
}

describe("followChange", () => {
  it("follows a change made in the window, keeping the earliest", () => {
    let w = clicked(NOW);
    w = followChange(w, NOW + 900);
    w = followChange(w, NOW + 400);
    w = followChange(w, NOW + 1200);
    expect(w.firstChangeAt).toBe(NOW + 400);
  });

  it("leaves a change made outside it", () => {
    const w = clicked(NOW, NOW - 300);
    for (const at of [NOW - 300, NOW - 1000, NOW + ACTION_FOLLOW_MS]) {
      expect(followChange(w, at)).toBe(w);
    }
  });
});

describe("followReadStarted", () => {
  it("lets go of what the read sees", () => {
    const w = followChange(clicked(NOW), NOW + 500);
    expect(followReadStarted(w).firstChangeAt).toBe(Infinity);
    expect(followReadStarted(w).until).toBe(w.until);
  });
});

describe("followAfterRead", () => {
  it("opens an action's window where its re-read started, read at once", () => {
    const w = followAfterRead(
      NOT_FOLLOWING,
      "action",
      NOW - 200,
      NOW - 50,
      NOW,
    );
    expect(w).toMatchObject({
      from: NOW - 200,
      until: NOW + ACTION_FOLLOW_MS,
      actionUntil: NOW + ACTION_FOLLOW_MS,
      // What the page did while the re-read ran.
      firstChangeAt: NOW - 50,
    });
    expect(isFollowed(w, NOW - 100)).toBe(true);
    expect(isFollowed(w, NOW - 300)).toBe(false);
  });

  it("keeps a destination still to read", () => {
    const pending = { ...NOT_FOLLOWING, destination: "input" as const };
    expect(
      followAfterRead(pending, "action", NOW - 200, Infinity, NOW).destination,
    ).toBe("input");
  });
});

describe("followPageInput", () => {
  it("opens a window after every change already heard of, a click's pace", () => {
    const w = clicked(NOW, NOW - 300);
    expect(w).toMatchObject({
      from: NOW - 300,
      until: NOW + ACTION_FOLLOW_MS,
      actionUntil: 0,
    });
    // Made before the click, though reported after it.
    expect(isFollowed(w, NOW - 300)).toBe(false);
    expect(isFollowed(w, NOW - 100)).toBe(true);
  });

  it("only stretches a window already open", () => {
    const first = clicked(NOW, NOW - 300);
    const w = followPageInput(first, NOW + 2000, NOW + 3000);
    expect(w).toMatchObject({
      from: NOW - 300,
      until: NOW + 3000 + ACTION_FOLLOW_MS,
    });
  });

  it("keeps what a window it closes followed, and that window's late reports", () => {
    // What the first click did, heard of just before the window closed and
    // still waiting on its quiet period.
    let w = followChange(clicked(NOW), NOW + 4600);
    // A change of the page's own, past the window, then a second click.
    const second = NOW + ACTION_FOLLOW_MS + 400;
    w = followPageInput(w, NOW + ACTION_FOLLOW_MS + 50, second);
    expect(w.firstChangeAt).toBe(NOW + 4600);
    // A report of the first click's doing that came late.
    expect(isFollowed(w, NOW + 4800)).toBe(true);
    // The page's own change between the two windows.
    expect(isFollowed(w, NOW + ACTION_FOLLOW_MS + 50)).toBe(false);
  });

  it("leaves an action's part read at once", () => {
    const action = followAfterRead(NOT_FOLLOWING, "action", NOW, Infinity, NOW);
    const later = NOW + ACTION_FOLLOW_MS + 1;
    expect(followPageInput(action, NOW, later).actionUntil).toBe(
      action.actionUntil,
    );
  });
});

describe("followTyping", () => {
  it("ends the window where the user typed", () => {
    const w = followTyping(clicked(NOW, NOW - 300), NOW + 800);
    expect(w).toMatchObject({ from: NOW - 300, until: NOW + 800 });
    // What the click did before, though reported later.
    expect(isFollowed(w, NOW + 500)).toBe(true);
    // What the typing did.
    expect(isFollowed(w, NOW + 801)).toBe(false);
  });

  it("keeps what the window followed until then", () => {
    const w = followChange(clicked(NOW), NOW + 500);
    expect(followTyping(w, NOW + 800).firstChangeAt).toBe(NOW + 500);
  });

  it("ends an action's window too", () => {
    const action = followAfterRead(NOT_FOLLOWING, "action", NOW, Infinity, NOW);
    expect(followTyping(action, NOW + 800)).toMatchObject({
      until: NOW + 800,
      actionUntil: NOW + 800,
    });
  });

  it("leaves a window a later click opened, and one already closed", () => {
    const w = clicked(NOW, NOW - 300);
    expect(followTyping(w, NOW - 500).until).toBe(w.until);
    expect(followTyping(w, NOW + ACTION_FOLLOW_MS + 1).until).toBe(w.until);
  });

  it("doesn't follow the page a navigation leads to once the user types there", () => {
    const pending = followNavigation(clicked(NOW), NOW + 1000);
    // Before its first read: no window.
    const before = followTyping(pending, NOW + 1200);
    expect(
      followDestination(before, NOW + 1500, NOW + 1600, NOW + 1800),
    ).toMatchObject({ until: 0, destination: null });
    // While it ran: a window up to the typing.
    const during = followTyping(pending, NOW + 1700);
    expect(
      followDestination(during, NOW + 1500, NOW + 1600, NOW + 1800),
    ).toMatchObject({ until: NOW + 1700, firstChangeAt: NOW + 1600 });
  });

  it("bounds a window a read opens, should the clock have stepped back", () => {
    const typed = followTyping(NOT_FOLLOWING, NOW + 3_600_000);
    expect(
      followAfterRead(typed, "action", NOW - 200, Infinity, NOW).until,
    ).toBe(NOW + ACTION_FOLLOW_MS);
  });

  it("ends a window a read opens where the user typed while it ran", () => {
    // Typed during an action's re-read, between a change before it and one
    // after.
    const typed = followTyping(NOT_FOLLOWING, NOW - 100);
    const w = followAfterRead(typed, "action", NOW - 200, NOW - 150, NOW);
    expect(w).toMatchObject({
      until: NOW - 100,
      actionUntil: NOW - 100,
      firstChangeAt: NOW - 150,
    });
    expect(
      followAfterRead(typed, "action", NOW - 200, NOW - 50, NOW).firstChangeAt,
    ).toBe(Infinity);
  });
});

describe("followNavigation", () => {
  it("follows the page a click leads to, at a click's pace", () => {
    const w = followNavigation(clicked(NOW), NOW + 1000);
    expect(w).toEqual({
      ...NOT_FOLLOWING,
      destination: "input",
      destinationAt: NOW + 1000,
    });
  });

  it("and the page an action leads to as an action's", () => {
    const action = followAfterRead(NOT_FOLLOWING, "action", NOW, Infinity, NOW);
    expect(followNavigation(action, NOW + 1000).destination).toBe("action");
  });

  it("not one that starts outside a window, though it keeps a redirect's", () => {
    const later = NOW + ACTION_FOLLOW_MS + 1;
    expect(followNavigation(clicked(NOW), later).destination).toBeNull();
    const redirected = followNavigation(clicked(NOW), NOW + 1000);
    expect(followNavigation(redirected, NOW + 3000).destination).toBe("input");
  });

  it("lets go of a destination no read took: too old, or typed past", () => {
    // A link that became a download, then another navigation.
    const pending = followNavigation(clicked(NOW), NOW + 1000);
    const later = NOW + 1000 + ACTION_FOLLOW_MS;
    expect(followNavigation(pending, later).destination).toBeNull();
    const typed = followTyping(pending, NOW + 1500);
    expect(followNavigation(typed, NOW + 2000).destination).toBeNull();
  });

  it("doesn't carry an old destination into a later click's window", () => {
    // An action's download, then, half a minute on, a click on a link.
    const action = followAfterRead(NOT_FOLLOWING, "action", NOW, Infinity, NOW);
    const download = followNavigation(action, NOW + 1000);
    expect(download.destination).toBe("action");
    const click = followPageInput(download, NOW, NOW + 30_000);
    expect(followNavigation(click, NOW + 30_500).destination).toBe("input");
  });

  it("keeps a redirect chain whose hops come within the window of each other", () => {
    let w = followNavigation(clicked(NOW), NOW + 1000);
    w = followNavigation(w, NOW + 4500);
    w = followNavigation(w, NOW + 7100);
    expect(w.destination).toBe("input");
  });
});

describe("followDestination", () => {
  it("opens the window the navigation carried, from the page's first read", () => {
    const pending = { ...NOT_FOLLOWING, destination: "input" as const };
    const w = followDestination(pending, NOW - 200, NOW - 50, NOW);
    expect(w).toMatchObject({
      from: NOW - 200,
      until: NOW + ACTION_FOLLOW_MS,
      actionUntil: 0,
      firstChangeAt: NOW - 50,
      destination: null,
    });
    const action = { ...NOT_FOLLOWING, destination: "action" as const };
    expect(
      followDestination(action, NOW - 200, Infinity, NOW).actionUntil,
    ).toBe(NOW + ACTION_FOLLOW_MS);
  });

  it("does nothing for a page no navigation in a window led to", () => {
    expect(followDestination(NOT_FOLLOWING, NOW - 200, NOW - 50, NOW)).toBe(
      NOT_FOLLOWING,
    );
  });
});
