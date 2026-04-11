import { describe, it, expect } from "vitest";
import {
  BOLT_PATH,
  BOLT_VIEWBOX,
  BOLT_FILL,
  BRAND_GRADIENT_START,
  BRAND_GRADIENT_END,
} from "./brand";

describe("brand constants", () => {
  it("BOLT_PATH is a non-empty SVG path", () => {
    expect(BOLT_PATH).toBeTruthy();
    expect(BOLT_PATH).toContain("M");
  });

  it("BOLT_VIEWBOX is a valid viewBox string", () => {
    expect(BOLT_VIEWBOX).toBe("0 0 32 32");
  });

  it("BOLT_FILL is a valid hex color", () => {
    expect(BOLT_FILL).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("gradient colors are valid hex colors", () => {
    expect(BRAND_GRADIENT_START).toMatch(/^#[0-9a-f]{6}$/);
    expect(BRAND_GRADIENT_END).toMatch(/^#[0-9a-f]{6}$/);
  });
});
