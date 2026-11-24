import { describe, expect, it } from "vitest";

import { nativeAXFacets } from "./ax-facets.js";

const prop = (name: string, value: unknown, type = "string") => ({
  name,
  value: { type, value },
});

describe("nativeAXFacets", () => {
  it("splits states from properties", () => {
    const { states, properties } = nativeAXFacets({
      role: { value: "button" },
      properties: [
        prop("expanded", true, "booleanOrUndefined"),
        prop("roledescription", "slide"),
        prop("orientation", "vertical"),
      ],
    });
    expect(states).toEqual({ expanded: true });
    expect(properties).toEqual({
      roledescription: "slide",
      orientation: "vertical",
    });
  });

  it("writes Chromium's hasPopup as haspopup", () => {
    const { properties } = nativeAXFacets({
      role: { value: "button" },
      properties: [prop("hasPopup", "menu")],
    });
    expect(properties).toEqual({ haspopup: "menu" });
  });

  it("drops an empty or whitespace roledescription, and keeps a real one", () => {
    const of = (text: string) =>
      nativeAXFacets({ properties: [prop("roledescription", text)] })
        .properties;
    expect(of("")).toEqual({});
    expect(of("  ")).toEqual({});
    expect(of(" slide ")).toEqual({ roledescription: " slide " });
  });

  it("never keeps valuenow or valuetext, or a property outside the table", () => {
    const { properties } = nativeAXFacets({
      properties: [
        prop("valuenow", 7, "number"),
        prop("valuetext", "seven"),
        prop("valuemin", 0, "number"),
        prop("describedby", "x"),
      ],
    });
    expect(properties).toEqual({ valuemin: "0" });
  });

  it("drops a list item's computed level and keeps a heading's", () => {
    const level = [prop("level", 2, "integer")];
    expect(
      nativeAXFacets({ role: { value: "listitem" }, properties: level })
        .properties,
    ).toEqual({});
    expect(
      nativeAXFacets({ role: { value: "heading" }, properties: level })
        .properties,
    ).toEqual({ level: "2" });
  });

  it("skips a property with no scalar value", () => {
    const { properties } = nativeAXFacets({
      properties: [{ name: "roledescription" }, prop("keyshortcuts", null)],
    });
    expect(properties).toEqual({});
  });
});
