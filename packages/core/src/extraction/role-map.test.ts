import { describe, it, expect, beforeEach } from "vitest";

import {
  getImplicitRole,
  isHiddenFromAT,
  isSubtreeHidden,
  getHeadingLevel,
} from "./role-map.js";

function el(html: string): Element {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.firstElementChild!;
}

describe("getImplicitRole", () => {
  it("returns link for <a> with href", () => {
    expect(getImplicitRole(el('<a href="/about">About</a>'))).toBe("link");
  });

  it("returns generic for <a> without href", () => {
    expect(getImplicitRole(el("<a>Not a link</a>"))).toBe("generic");
  });

  it("returns button for <button>", () => {
    expect(getImplicitRole(el("<button>Click</button>"))).toBe("button");
  });

  it("returns navigation for <nav>", () => {
    expect(getImplicitRole(el("<nav>Nav</nav>"))).toBe("navigation");
  });

  it("returns main for <main>", () => {
    expect(getImplicitRole(el("<main>Content</main>"))).toBe("main");
  });

  it("returns heading for h1-h6", () => {
    expect(getImplicitRole(el("<h1>Title</h1>"))).toBe("heading");
    expect(getImplicitRole(el("<h2>Subtitle</h2>"))).toBe("heading");
    expect(getImplicitRole(el("<h3>Section</h3>"))).toBe("heading");
  });

  it("returns list for <ul> and <ol>", () => {
    expect(getImplicitRole(el("<ul><li>A</li></ul>"))).toBe("list");
    expect(getImplicitRole(el("<ol><li>A</li></ol>"))).toBe("list");
  });

  it("returns listitem for <li>", () => {
    expect(getImplicitRole(el("<li>Item</li>"))).toBe("listitem");
  });

  it("returns textbox for <input type=text>", () => {
    expect(getImplicitRole(el('<input type="text">'))).toBe("textbox");
  });

  it("returns checkbox for <input type=checkbox>", () => {
    expect(getImplicitRole(el('<input type="checkbox">'))).toBe("checkbox");
  });

  it("returns radio for <input type=radio>", () => {
    expect(getImplicitRole(el('<input type="radio">'))).toBe("radio");
  });

  it("returns button for <input type=submit>", () => {
    expect(getImplicitRole(el('<input type="submit">'))).toBe("button");
  });

  it("returns textbox for <textarea>", () => {
    expect(getImplicitRole(el("<textarea></textarea>"))).toBe("textbox");
  });

  it("returns table for <table>", () => {
    expect(getImplicitRole(el("<table></table>"))).toBe("table");
  });

  it("returns form for <form>", () => {
    expect(getImplicitRole(el("<form></form>"))).toBe("form");
  });

  it("returns img for <img> with alt", () => {
    expect(getImplicitRole(el('<img alt="photo">'))).toBe("img");
  });

  it("returns presentation for <img> with empty alt", () => {
    expect(getImplicitRole(el('<img alt="">'))).toBe("presentation");
  });

  it("returns presentation for explicit role=presentation", () => {
    expect(getImplicitRole(el('<div role="presentation">Decor</div>'))).toBe(
      "presentation",
    );
  });

  it("returns presentation for explicit role=none (synonym)", () => {
    expect(getImplicitRole(el('<span role="none">Decor</span>'))).toBe(
      "presentation",
    );
  });

  it("returns generic for <div>", () => {
    expect(getImplicitRole(el("<div>Content</div>"))).toBe("generic");
  });

  it("returns generic for <span>", () => {
    expect(getImplicitRole(el("<span>Text</span>"))).toBe("generic");
  });

  it("returns region for <section> with accessible name", () => {
    expect(
      getImplicitRole(el('<section aria-label="Main content"></section>')),
    ).toBe("region");
  });

  it("returns generic for <section> without accessible name", () => {
    expect(getImplicitRole(el("<section></section>"))).toBe("generic");
  });

  it("uses explicit role attribute when present", () => {
    expect(getImplicitRole(el('<div role="alert">Warning</div>'))).toBe(
      "alert",
    );
  });

  it("returns article for <article>", () => {
    expect(getImplicitRole(el("<article>Post</article>"))).toBe("article");
  });

  it("returns complementary for <aside>", () => {
    expect(getImplicitRole(el("<aside>Sidebar</aside>"))).toBe("complementary");
  });

  it("returns dialog for <dialog>", () => {
    expect(getImplicitRole(el("<dialog>Modal</dialog>"))).toBe("dialog");
  });

  it("returns separator for <hr>", () => {
    expect(getImplicitRole(el("<hr>"))).toBe("separator");
  });

  it("returns figure for <figure>", () => {
    expect(getImplicitRole(el("<figure>Chart</figure>"))).toBe("figure");
  });

  it("returns search for <search>", () => {
    expect(getImplicitRole(el("<search>Form</search>"))).toBe("search");
  });

  // ARIA has no media roles, but Chromium's native accessibility tree
  // exposes internal Video/Audio roles (what DevTools shows). Mirroring
  // that beats "generic", which made a captioned player indistinguishable
  // from a <div>.
  it("returns video for <video> and audio for <audio>", () => {
    expect(getImplicitRole(el("<video></video>"))).toBe("video");
    expect(getImplicitRole(el("<video controls></video>"))).toBe("video");
    expect(getImplicitRole(el("<audio></audio>"))).toBe("audio");
  });

  it("explicit role still wins on media elements", () => {
    expect(getImplicitRole(el('<video role="application"></video>'))).toBe(
      "application",
    );
  });
});

describe("isHiddenFromAT", () => {
  it("hides script elements", () => {
    expect(isHiddenFromAT(el("<script>code</script>"))).toBe(true);
  });

  it("hides style elements", () => {
    expect(isHiddenFromAT(el("<style>.x{}</style>"))).toBe(true);
  });

  it("hides aria-hidden=true elements", () => {
    expect(isHiddenFromAT(el('<div aria-hidden="true">Hidden</div>'))).toBe(
      true,
    );
  });

  // role="presentation" / role="none" are NOT hidden — getImplicitRole maps
  // them to the "presentation" role and the a11y extractor flattens the
  // element from the tree (children are promoted to the parent).
  it("does not hide role=presentation elements (children are kept)", () => {
    expect(isHiddenFromAT(el('<div role="presentation">Decor</div>'))).toBe(
      false,
    );
  });

  it("does not hide role=none elements (children are kept)", () => {
    expect(isHiddenFromAT(el('<div role="none">None</div>'))).toBe(false);
  });

  it("does not hide normal elements", () => {
    expect(isHiddenFromAT(el("<div>Visible</div>"))).toBe(false);
  });

  it("does not hide aria-hidden=false elements", () => {
    expect(isHiddenFromAT(el('<div aria-hidden="false">Shown</div>'))).toBe(
      false,
    );
  });

  it("shares subtree-hidden checks with isSubtreeHidden (display:none)", () => {
    // Drift guard: isHiddenFromAT must keep calling isSubtreeHidden for the
    // overlapping conditions rather than re-implementing them. display:none
    // is the shared CSS path both predicates must agree on.
    const node = el('<div style="display:none">Gone</div>');
    document.body.appendChild(node);
    try {
      expect(isSubtreeHidden(node)).toBe(true);
      expect(isHiddenFromAT(node)).toBe(true);
    } finally {
      node.remove();
    }
  });

  it("treats visibility:hidden as AT-hidden but not subtree-hidden", () => {
    // visibility:hidden is NOT subtree-hiding (a child can override to
    // visible), so the walk still descends — but AT must not see the node.
    const node = el('<div style="visibility:hidden">Ghost</div>');
    document.body.appendChild(node);
    try {
      expect(isSubtreeHidden(node)).toBe(false);
      expect(isHiddenFromAT(node)).toBe(true);
    } finally {
      node.remove();
    }
  });
});

describe("getHeadingLevel", () => {
  it("returns correct level for h1-h6", () => {
    expect(getHeadingLevel(el("<h1>Title</h1>"))).toBe(1);
    expect(getHeadingLevel(el("<h2>Subtitle</h2>"))).toBe(2);
    expect(getHeadingLevel(el("<h3>Section</h3>"))).toBe(3);
    expect(getHeadingLevel(el("<h4>Sub</h4>"))).toBe(4);
    expect(getHeadingLevel(el("<h5>Minor</h5>"))).toBe(5);
    expect(getHeadingLevel(el("<h6>Tiny</h6>"))).toBe(6);
  });

  it("returns null for non-heading elements", () => {
    expect(getHeadingLevel(el("<div>Not heading</div>"))).toBe(null);
    expect(getHeadingLevel(el("<p>Paragraph</p>"))).toBe(null);
  });

  it("returns aria-level for role=heading", () => {
    expect(
      getHeadingLevel(el('<div role="heading" aria-level="3">Heading</div>')),
    ).toBe(3);
  });
});
