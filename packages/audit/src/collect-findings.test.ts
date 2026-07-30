import type { ExtractionResult, SemanticNode } from "@real-a11y-dev/core";
import { describe, it, expect } from "vitest";

import { collectFindings, listByRole, ALL_RULES } from "./index.js";

function mount(html: string): HTMLElement {
  document.body.innerHTML = "";
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

describe("collectFindings — no-unlabeled-interactive", () => {
  it("flags an unlabeled button and records role + tagName", () => {
    const root = mount(`<button></button>`);
    const findings = collectFindings(root, ["no-unlabeled-interactive"]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      rule: "no-unlabeled-interactive",
      severity: "error",
      role: "button",
      tagName: "button",
    });
  });

  it("passes a labeled control", () => {
    const root = mount(`<button>Go</button>`);
    expect(collectFindings(root, ["no-unlabeled-interactive"])).toEqual([]);
  });

  it("reports every offender, not just the first", () => {
    const root = mount(`<button></button><a href="#"></a>`);
    const findings = collectFindings(root, ["no-unlabeled-interactive"]);
    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.role).sort()).toEqual(["button", "link"]);
  });
});

describe("collectFindings — heading-order", () => {
  it("flags a missing h1", () => {
    const root = mount(`<h2>Only</h2>`);
    const findings = collectFindings(root, ["heading-order"]);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toMatch(/Missing <h1>/);
  });

  it("flags multiple h1s", () => {
    const root = mount(`<h1>A</h1><h1>B</h1>`);
    const findings = collectFindings(root, ["heading-order"]);
    expect(
      findings.some((f) => /Expected exactly one <h1>/.test(f.message)),
    ).toBe(true);
  });

  it("flags a skipped level and names the heading", () => {
    const root = mount(`<h1>A</h1><h3>B</h3>`);
    const findings = collectFindings(root, ["heading-order"]);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toMatch(/level skipped/i);
    expect(findings[0].name).toBe("B");
  });

  it("passes a well-ordered outline", () => {
    const root = mount(`<h1>A</h1><h2>B</h2><h3>C</h3>`);
    expect(collectFindings(root, ["heading-order"])).toEqual([]);
  });
});

describe("collectFindings — dialog-labeled", () => {
  it("flags an unlabeled dialog", () => {
    const root = mount(`<div role="dialog"></div>`);
    const findings = collectFindings(root, ["dialog-labeled"]);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("dialog-labeled");
  });

  it("passes a labeled dialog", () => {
    const root = mount(`<div role="dialog" aria-label="Confirm">x</div>`);
    expect(collectFindings(root, ["dialog-labeled"])).toEqual([]);
  });

  it("also checks alertdialog", () => {
    const root = mount(`<div role="alertdialog"></div>`);
    expect(collectFindings(root, ["dialog-labeled"])).toHaveLength(1);
  });
});

describe("collectFindings — landmark-structure", () => {
  it("flags a missing main", () => {
    const root = mount(`<div>no landmarks</div>`);
    const findings = collectFindings(root, ["landmark-structure"]);
    expect(findings.some((f) => /Missing <main>/.test(f.message))).toBe(true);
  });

  it("flags two mains", () => {
    const root = mount(`<main>A</main><main>B</main>`);
    const findings = collectFindings(root, ["landmark-structure"]);
    expect(findings.some((f) => /exactly one <main>/.test(f.message))).toBe(
      true,
    );
  });

  it("flags duplicate banner and contentinfo landmarks", () => {
    const root = mount(
      `<main>x</main>
       <header>a</header><header>b</header>
       <footer>a</footer><footer>b</footer>`,
    );
    const findings = collectFindings(root, ["landmark-structure"]);
    expect(findings.some((f) => /banner/.test(f.message))).toBe(true);
    expect(findings.some((f) => /contentinfo/.test(f.message))).toBe(true);
  });

  it("passes a single main", () => {
    const root = mount(`<main>A</main>`);
    expect(collectFindings(root, ["landmark-structure"])).toEqual([]);
  });
});

describe("collectFindings — rule selection & aggregation", () => {
  it("runs only the requested rules", () => {
    // Unlabeled button (labels rule) AND missing main (landmark rule) present.
    const root = mount(`<button></button>`);
    const onlyLabels = collectFindings(root, ["no-unlabeled-interactive"]);
    expect(onlyLabels.every((f) => f.rule === "no-unlabeled-interactive")).toBe(
      true,
    );
    // Restricting to landmarks must not surface the button.
    const onlyLandmarks = collectFindings(root, ["landmark-structure"]);
    expect(onlyLandmarks.every((f) => f.rule === "landmark-structure")).toBe(
      true,
    );
  });

  it("defaults to all rules and aggregates findings across them", () => {
    // h1->h3 skip + unlabeled button + no main → three distinct rules fire.
    const root = mount(`<h1>A</h1><h3>B</h3><button></button>`);
    const findings = collectFindings(root);
    const rules = new Set(findings.map((f) => f.rule));
    expect(rules.has("no-unlabeled-interactive")).toBe(true);
    expect(rules.has("heading-order")).toBe(true);
    expect(rules.has("landmark-structure")).toBe(true);
  });

  it("returns nothing for a clean subtree", () => {
    const root = mount(
      `<main><h1>Title</h1><button>Go</button><a href="#">Docs</a></main>`,
    );
    expect(collectFindings(root, ALL_RULES)).toEqual([]);
  });
});

describe("collectFindings — image-alt", () => {
  it("flags an image with no accessible name", () => {
    const root = mount(`<img src="a.png">`);
    const findings = collectFindings(root, ["image-alt"]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      rule: "image-alt",
      severity: "warning",
    });
  });

  it("passes an image with alt text", () => {
    const root = mount(`<img src="a.png" alt="A logo">`);
    expect(collectFindings(root, ["image-alt"])).toEqual([]);
  });

  it("passes a decorative image (alt='')", () => {
    const root = mount(`<img src="a.png" alt="">`);
    expect(collectFindings(root, ["image-alt"])).toEqual([]);
  });
});

describe("listByRole", () => {
  it("lists links only, with names and locators", () => {
    const root = mount(
      `<a id="home" href="/x">Home</a><a href="/y">Docs</a><button>Go</button>`,
    );
    const out = listByRole(root, "link");
    const lines = out.split("\n");
    expect(lines).toHaveLength(2);
    expect(out).toMatch(/link "Home"/);
    expect(out).toMatch(/link "Docs"/);
    expect(out).not.toMatch(/button/);
    expect(out).toContain("#home"); // locator
  });

  it("lists form controls (the 'form' group), not buttons", () => {
    const root = mount(
      `<input aria-label="Email"><input type="checkbox" aria-label="Ok"><button>Go</button>`,
    );
    const out = listByRole(root, "form");
    expect(out).toMatch(/textbox "Email"/);
    expect(out).toMatch(/checkbox "Ok"/);
    expect(out).not.toMatch(/button/);
  });

  it("lists images", () => {
    const root = mount(`<img alt="A logo"><p>text</p>`);
    expect(listByRole(root, "image")).toMatch(/img "A logo"/);
  });

  describe("nothing matched", () => {
    // A bare "(none)" answered three different questions identically. Each of
    // these is a different problem with a different fix, so each says which.
    it("reports how much was scanned, so an empty page is distinguishable", () => {
      const out = listByRole(mount(`<p>hi</p><p>there</p>`), "link");
      expect(out).toMatch(/^\(none — filter "link" matched 0 of \d+ nodes;/);
      // The denominator has to be real — a hardcoded 0 would defeat the point.
      expect(out).not.toMatch(/0 of 0 nodes/);
    });

    it("names the roles the filter looks for", () => {
      // `image` looks for exactly `img`, so a page whose graphics are figures
      // reports none — unexplainable without the role named.
      expect(listByRole(mount(`<figure>chart</figure>`), "image")).toMatch(
        /it looks for role img\)$/,
      );
    });

    it("names all of a multi-role group", () => {
      // And `form` looks for the FIELDS — it does not include the `form` role,
      // which lives under `landmark`. That reads as a bug until you see the list.
      const out = listByRole(mount(`<p>hi</p>`), "form");
      expect(out).toMatch(/it looks for roles /);
      for (const role of ["textbox", "checkbox", "searchbox", "slider"]) {
        expect(out).toContain(role);
      }
      expect(out).not.toMatch(/looks for .*\bform\b/);
    });

    it("says the tree was empty, rather than blaming the filter", () => {
      // Nothing extracted at all: the page never loaded, or extraction failed.
      // Reporting "0 of 0 matched" would point at the wrong thing.
      const out = listByRole({ nodes: new Map(), rootId: "" }, "link");
      expect(out).toMatch(/the tree is empty/);
      expect(out).toMatch(/may not have loaded, or extraction failed/);
    });

    it("still reports an unknown filter as such", () => {
      expect(listByRole(mount(`<p>hi</p>`), "nope" as never)).toBe(
        '(unknown filter "nope")',
      );
    });

    it("never returns an empty string — callers need no sentinel", () => {
      for (const filter of [
        "heading",
        "link",
        "button",
        "form",
        "landmark",
        "image",
      ] as const) {
        expect(listByRole(mount(`<p>hi</p>`), filter)).not.toBe("");
      }
    });
  });
});

describe("collectFindings — locators, context & severity", () => {
  it("uses an element id as the locator when present", () => {
    const root = mount(`<button id="go"></button>`);
    const [f] = collectFindings(root, ["no-unlabeled-interactive"]);
    expect(f.locator).toBe("#go");
  });

  it("builds a path locator when there is no id", () => {
    const root = mount(`<div><span></span><button></button></div>`);
    const [f] = collectFindings(root, ["no-unlabeled-interactive"]);
    expect(f.locator).toBeTruthy();
    expect(f.locator).toMatch(/button/);
  });

  it("includes href context for links", () => {
    const root = mount(`<a href="/help/faq"></a>`);
    const [f] = collectFindings(root, ["no-unlabeled-interactive"]);
    expect(f.context).toMatch(/href="\/help\/faq"/);
  });

  it("grades severity: interactive is error, heading order is warning", () => {
    const unlabeled = collectFindings(mount(`<button></button>`), [
      "no-unlabeled-interactive",
    ]);
    expect(unlabeled[0].severity).toBe("error");

    const heading = collectFindings(mount(`<h2>Only</h2>`), ["heading-order"]);
    expect(heading[0].severity).toBe("warning");
  });
});

describe("collectFindings — locators on a pre-extracted tree", () => {
  // A native tree arrives in Node with no live elements behind it, so the
  // element-ref lookup `locate` normally uses finds nothing. The producer
  // computed the locator during its own document walk and parked it on the
  // `dom` facet; these pin that it survives into the finding. Without it a
  // native audit reports real defects with no address at all.
  function nativeNode(
    id: string,
    role: string,
    dom?: { tagName: string; locator?: string },
  ): SemanticNode {
    return {
      id,
      parentId: id === "ax-1" ? null : "ax-1",
      childIds: [],
      depth: id === "ax-1" ? 0 : 1,
      a11y: { role, name: "", states: {}, properties: {} },
      ...(dom
        ? {
            dom: {
              tagName: dom.tagName,
              attributes: {},
              textContent: null,
              isHidden: false,
              ...(dom.locator ? { locator: dom.locator } : {}),
            },
          }
        : {}),
    } as SemanticNode;
  }

  function nativeTree(nodes: SemanticNode[]): ExtractionResult {
    const root = nativeNode("ax-1", "document");
    root.childIds = nodes.map((n) => n.id);
    const all = new Map<string, SemanticNode>([["ax-1", root]]);
    for (const n of nodes) all.set(n.id, n);
    return {
      rootId: "ax-1",
      nodes: all,
      source: { producer: "native" },
    } as ExtractionResult;
  }

  it("uses the locator the producer precomputed", () => {
    const tree = nativeTree([
      nativeNode("ax-dom-10", "button", {
        tagName: "button",
        locator: "#go",
      }),
      nativeNode("ax-dom-11", "img", {
        tagName: "img",
        locator: "body > main > img:nth-of-type(2)",
      }),
    ]);
    const findings = collectFindings(tree, [
      "no-unlabeled-interactive",
      "image-alt",
    ]);
    expect(findings.map((f) => f.locator)).toEqual([
      "#go",
      "body > main > img:nth-of-type(2)",
    ]);
  });

  it("still reports the finding when no locator was computed", () => {
    const findings = collectFindings(
      nativeTree([nativeNode("ax-dom-10", "button", { tagName: "button" })]),
      ["no-unlabeled-interactive"],
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].locator).toBeUndefined();
  });

  it("omits context, which needs a live element the native tree never has", () => {
    const findings = collectFindings(
      nativeTree([
        nativeNode("ax-dom-10", "link", { tagName: "a", locator: "#help" }),
      ]),
      ["no-unlabeled-interactive"],
    );
    expect(findings[0].locator).toBe("#help");
    expect(findings[0].context).toBeUndefined();
  });
});
