/**
 * One-shot CDP probe — dump raw getFullAXTree shape for the fixture.
 * Run: pnpm --filter @real-a11y-dev/browser exec tsx spike/native-tree/probe.mts
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "fixture.html"), "utf8");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setContent(html, { waitUntil: "load" });

const client = await page.context().newCDPSession(page);
await client.send("Accessibility.enable");
const { nodes } = (await client.send("Accessibility.getFullAXTree")) as {
  nodes: Array<Record<string, unknown>>;
};

// Summarize interesting fields present on nodes
const keys = new Set<string>();
for (const n of nodes) for (const k of Object.keys(n)) keys.add(k);

const sample = nodes
  .filter((n) => {
    const role = (n.role as { value?: string } | undefined)?.value ?? "";
    return /video|audio|slider|button|textbox|heading|password|StaticText|InlineTextBox/i.test(
      role,
    );
  })
  .slice(0, 40)
  .map((n) => ({
    nodeId: n.nodeId,
    backendDOMNodeId: n.backendDOMNodeId,
    ignored: n.ignored,
    role: (n.role as { value?: string } | undefined)?.value,
    name: (n.name as { value?: string } | undefined)?.value,
    description: (n.description as { value?: string } | undefined)?.value,
    childIds: n.childIds,
    parentId: n.parentId,
    properties: n.properties,
  }));

console.log(JSON.stringify({ nodeCount: nodes.length, keys: [...keys].sort(), sample }, null, 2));

// Also try DOM.resolve for first node with backendDOMNodeId
const withBackend = nodes.find((n) => typeof n.backendDOMNodeId === "number");
if (withBackend) {
  await client.send("DOM.enable");
  await client.send("DOM.getDocument", { depth: 0 });
  const backendId = withBackend.backendDOMNodeId as number;
  try {
    const pushed = await client.send("DOM.pushNodesByBackendIdsToFrontend", {
      backendNodeIds: [backendId],
    });
    console.error(
      "\npushNodesByBackendIdsToFrontend:",
      JSON.stringify(pushed),
    );
    const resolved = await client.send("DOM.resolveNode", {
      backendNodeId: backendId,
    });
    console.error("DOM.resolveNode keys:", Object.keys(resolved as object));
    const objectId = (resolved as { object?: { objectId?: string } }).object
      ?.objectId;
    if (objectId) {
      const evaled = await client.send("Runtime.callFunctionOn", {
        objectId,
        functionDeclaration: `function() {
          return {
            tagName: this.tagName || null,
            id: this.id || null,
            type: this.type || null,
            value: this.value !== undefined ? String(this.value) : null,
            autocomplete: this.getAttribute ? this.getAttribute('autocomplete') : null,
          };
        }`,
        returnByValue: true,
      });
      console.error("resolved element:", JSON.stringify(evaled, null, 2));
    }

    // Resolve the password textbox specifically if present
    const pw = nodes.find((n) => {
      const role = (n.role as { value?: string } | undefined)?.value;
      const name = (n.name as { value?: string } | undefined)?.value ?? "";
      return role === "textbox" && /password/i.test(name);
    });
    if (pw && typeof pw.backendDOMNodeId === "number") {
      const pwResolved = await client.send("DOM.resolveNode", {
        backendNodeId: pw.backendDOMNodeId,
      });
      const pwOid = (pwResolved as { object?: { objectId?: string } }).object
        ?.objectId;
      if (pwOid) {
        const pwEval = await client.send("Runtime.callFunctionOn", {
          objectId: pwOid,
          functionDeclaration: `function() {
            return {
              tagName: this.tagName,
              type: this.type,
              value: String(this.value),
              autocomplete: this.getAttribute('autocomplete'),
            };
          }`,
          returnByValue: true,
        });
        console.error("password field via CDP:", JSON.stringify(pwEval));
      }
      console.error(
        "password AX node value field:",
        JSON.stringify(pw.value ?? null),
      );
    }

    // Dump Video subtree roles
    const video = nodes.find(
      (n) => (n.role as { value?: string } | undefined)?.value === "Video",
    );
    if (video) {
      const byId = new Map(nodes.map((n) => [n.nodeId as string, n]));
      const walk = (id: string, depth: number): void => {
        const n = byId.get(id);
        if (!n) return;
        const role = (n.role as { value?: string } | undefined)?.value;
        const name = (n.name as { value?: string } | undefined)?.value ?? "";
        console.error(
          `${"  ".repeat(depth)}${role}${name ? ` "${name}"` : ""}${n.ignored ? " [ignored]" : ""} backend=${n.backendDOMNodeId ?? "-"}`,
        );
        for (const cid of (n.childIds as string[] | undefined) ?? []) {
          walk(cid, depth + 1);
        }
      };
      console.error("\nVideo subtree:");
      walk(video.nodeId as string, 0);
    }
  } catch (err) {
    console.error("backend resolve failed:", err);
  }
}

await client.detach().catch(() => {});
await browser.close();
