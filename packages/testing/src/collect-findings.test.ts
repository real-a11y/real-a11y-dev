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

  it("returns (none) when nothing matches", () => {
    expect(listByRole(mount(`<p>hi</p>`), "link")).toBe("(none)");
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
