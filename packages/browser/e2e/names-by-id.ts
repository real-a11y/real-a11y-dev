/**
 * Each `id`-ed element's name and description, as the DOM producer, the native
 * producer and Chromium's raw CDP tree read the page, for the e2e suites that
 * pin a name rule to what Chromium reports.
 */
import { nativeTree, pageBundleSource } from "@real-a11y-dev/browser";
import type { Page } from "playwright";

export interface Read {
  name: string;
  description: string;
}

export type ById = Record<string, Read>;

/** The DOM producer's reading, through the injected page bundle. */
export async function domById(page: Page, redactInput: boolean): Promise<ById> {
  await page.addScriptTag({ content: pageBundleSource() });
  return page.evaluate((redactInput) => {
    const ra = (globalThis as Record<string, unknown>).__realA11y__ as {
      extractA11yTree(
        root: Element,
        options: { redactInput: boolean },
      ): {
        nodes: Map<
          string,
          {
            dom?: { attributes: Record<string, string> };
            a11y: { name: string; description?: string };
          }
        >;
      };
    };
    const out: Record<string, { name: string; description: string }> = {};
    const tree = ra.extractA11yTree(document.body, { redactInput });
    for (const node of tree.nodes.values()) {
      const id = node.dom?.attributes["id"];
      if (id) {
        out[id] = {
          name: node.a11y.name,
          description: node.a11y.description ?? "",
        };
      }
    }
    return out;
  }, redactInput);
}

/** The native producer's reading. */
export async function nativeById(
  page: Page,
  redactInput: boolean,
): Promise<ById> {
  const out: ById = {};
  for (const node of (await nativeTree(page, { redactInput })).nodes.values()) {
    const id = node.dom?.attributes["id"];
    if (id) {
      out[id] = {
        name: node.a11y.name,
        description: node.a11y.description ?? "",
      };
    }
  }
  return out;
}

/** Chromium's raw CDP tree, ASCII-trimmed as both producers trim a name. */
export async function rawById(page: Page): Promise<ById> {
  const out: ById = {};
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("DOM.enable");
    await cdp.send("Accessibility.enable");
    const { nodes } = (await cdp.send("Accessibility.getFullAXTree")) as {
      nodes: {
        backendDOMNodeId?: number;
        ignored?: boolean;
        name?: { value?: string };
        description?: { value?: string };
      }[];
    };
    for (const n of nodes) {
      if (n.ignored || n.backendDOMNodeId === undefined) continue;
      const { node } = (await cdp.send("DOM.describeNode", {
        backendNodeId: n.backendDOMNodeId,
      })) as { node: { attributes?: string[] } };
      const attrs = node.attributes ?? [];
      const at = attrs.indexOf("id");
      if (at >= 0) {
        out[attrs[at + 1]!] = {
          name: (n.name?.value ?? "").replace(
            /^[ \t\n\f\r]+|[ \t\n\f\r]+$/g,
            "",
          ),
          description: n.description?.value ?? "",
        };
      }
    }
  } finally {
    await cdp.detach();
  }
  return out;
}
