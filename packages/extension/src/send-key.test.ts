import { LiveTreeExtractor, getElementRefs } from "@real-a11y-dev/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  closeOpenDialog,
  elementsFromTabSequence,
  moveFocusAlongTabSequence,
  sendKey,
} from "./send-key.js";

afterEach(() => {
  document.body.innerHTML = "";
  getElementRefs().clear();
});

function mount(html: string): void {
  document.body.innerHTML = html;
}

/** Same wiring the content script uses: live extract → getTabSequence → refs. */
function resolveFromLive(): HTMLElement[] {
  const live = new LiveTreeExtractor(document.documentElement, {
    mode: "dom",
  });
  return elementsFromTabSequence(live.extract(), getElementRefs());
}

describe("elementsFromTabSequence", () => {
  it("follows core getTabSequence order (positive tabindex first)", () => {
    mount(`
      <button id="a">A</button>
      <button id="b" tabindex="2">B</button>
      <a id="c" href="#c">C</a>
      <input id="d" tabindex="1" />
    `);
    expect(resolveFromLive().map((el) => el.id)).toEqual(["d", "b", "a", "c"]);
  });

  it("excludes tabindex=-1 and disabled nodes (core policy)", () => {
    mount(`
      <button id="ok">OK</button>
      <button id="skip" tabindex="-1">Skip</button>
      <button id="dis" disabled>Dis</button>
      <button id="next">Next</button>
    `);
    expect(resolveFromLive().map((el) => el.id)).toEqual(["ok", "next"]);
  });
});

describe("moveFocusAlongTabSequence", () => {
  it("moves focus forward and wraps", () => {
    mount(`
      <button id="a">A</button>
      <button id="b">B</button>
      <button id="c">C</button>
    `);
    const seq = resolveFromLive();
    const a = document.getElementById("a")!;
    const b = document.getElementById("b")!;
    const c = document.getElementById("c")!;
    a.focus();
    moveFocusAlongTabSequence(document, 1, seq);
    expect(document.activeElement).toBe(b);
    moveFocusAlongTabSequence(document, 1, seq);
    expect(document.activeElement).toBe(c);
    moveFocusAlongTabSequence(document, 1, seq);
    expect(document.activeElement).toBe(a);
  });

  it("moves focus backward with Shift+Tab direction", () => {
    mount(`
      <button id="a">A</button>
      <button id="b">B</button>
    `);
    const seq = resolveFromLive();
    document.getElementById("a")!.focus();
    moveFocusAlongTabSequence(document, -1, seq);
    expect(document.activeElement).toBe(document.getElementById("b"));
  });

  it("scopes the sequence to an open dialog (focus trap)", () => {
    mount(`
      <button id="outside">Outside</button>
      <dialog id="dlg" open>
        <button id="in1">In1</button>
        <button id="in2">In2</button>
      </dialog>
    `);
    const seq = resolveFromLive();
    document.getElementById("in1")!.focus();
    moveFocusAlongTabSequence(document, 1, seq);
    expect(document.activeElement).toBe(document.getElementById("in2"));
    moveFocusAlongTabSequence(document, 1, seq);
    expect(document.activeElement).toBe(document.getElementById("in1"));
  });
});

describe("closeOpenDialog", () => {
  it("closes the open dialog that contains focus", () => {
    mount(`
      <dialog id="dlg" open><button id="inside">Inside</button></dialog>
    `);
    const dlg = document.getElementById("dlg") as HTMLDialogElement;
    expect(dlg.open).toBe(true);
    document.getElementById("inside")!.focus();
    closeOpenDialog(document);
    expect(dlg.open).toBe(false);
  });

  it("closes the last open dialog when focus is outside", () => {
    mount(`
      <dialog id="a" open></dialog>
      <dialog id="b" open></dialog>
      <button id="out">Out</button>
    `);
    document.getElementById("out")!.focus();
    closeOpenDialog(document);
    expect((document.getElementById("a") as HTMLDialogElement).open).toBe(true);
    expect((document.getElementById("b") as HTMLDialogElement).open).toBe(
      false,
    );
  });
});

describe("sendKey", () => {
  const opts = { resolveTabSequence: resolveFromLive };

  it("dispatches keydown and keyup on the target", () => {
    mount(`<button id="t">T</button>`);
    const t = document.getElementById("t")!;
    const keys: string[] = [];
    t.addEventListener("keydown", (e) => keys.push(`down:${e.key}`));
    t.addEventListener("keyup", (e) => keys.push(`up:${e.key}`));
    sendKey(t, { key: "Enter", code: "Enter", keyCode: 13 }, opts);
    expect(keys).toEqual(["down:Enter", "up:Enter"]);
  });

  it("moves focus on Tab when keydown is not prevented", () => {
    mount(`
      <button id="a">A</button>
      <button id="b">B</button>
    `);
    const a = document.getElementById("a")!;
    a.focus();
    sendKey(a, { key: "Tab", code: "Tab", keyCode: 9 }, opts);
    expect(document.activeElement).toBe(document.getElementById("b"));
  });

  it("moves focus backward on Shift+Tab", () => {
    mount(`
      <button id="a">A</button>
      <button id="b">B</button>
    `);
    const b = document.getElementById("b")!;
    b.focus();
    sendKey(
      b,
      {
        key: "Tab",
        code: "Tab",
        keyCode: 9,
        modifiers: { shift: true },
      },
      opts,
    );
    expect(document.activeElement).toBe(document.getElementById("a"));
  });

  it("skips native Tab when keydown preventDefault is called", () => {
    mount(`
      <button id="a">A</button>
      <button id="b">B</button>
    `);
    const a = document.getElementById("a")!;
    a.focus();
    a.addEventListener("keydown", (e) => e.preventDefault());
    sendKey(a, { key: "Tab", code: "Tab", keyCode: 9 }, opts);
    expect(document.activeElement).toBe(a);
  });

  it("closes an open dialog on Escape", () => {
    mount(`
      <dialog id="dlg" open><button id="inside">Inside</button></dialog>
    `);
    const inside = document.getElementById("inside")!;
    const dlg = document.getElementById("dlg") as HTMLDialogElement;
    inside.focus();
    sendKey(inside, { key: "Escape", code: "Escape", keyCode: 27 }, opts);
    expect(dlg.open).toBe(false);
  });

  it("skips closing dialog when Escape keydown is prevented", () => {
    mount(`
      <dialog id="dlg" open><button id="inside">Inside</button></dialog>
    `);
    const inside = document.getElementById("inside")!;
    const dlg = document.getElementById("dlg") as HTMLDialogElement;
    inside.focus();
    inside.addEventListener("keydown", (e) => e.preventDefault());
    sendKey(inside, { key: "Escape", code: "Escape", keyCode: 27 }, opts);
    expect(dlg.open).toBe(true);
  });

  it("still fires keyup after a prevented keydown", () => {
    mount(`<button id="t">T</button>`);
    const t = document.getElementById("t")!;
    const spy = vi.fn();
    t.addEventListener("keydown", (e) => e.preventDefault());
    t.addEventListener("keyup", spy);
    sendKey(t, { key: "Tab", code: "Tab", keyCode: 9 }, opts);
    expect(spy).toHaveBeenCalledOnce();
  });
});
