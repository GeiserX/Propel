import { describe, it, expect } from "vitest";
import { FUEL_TYPES, FUEL_TYPE_MAP, FUEL_CATEGORIES } from "./fuel";

describe("FUEL_TYPES", () => {
  it("contains expected fuel types", () => {
    const codes = FUEL_TYPES.map((f) => f.code);
    expect(codes).toContain("B7");
    expect(codes).toContain("E5");
    expect(codes).toContain("E10");
    expect(codes).toContain("LPG");
    expect(codes).toContain("EV");
    expect(codes).toContain("H2");
    expect(codes).toContain("ADBLUE");
  });

  it("all entries have label and valid category", () => {
    const validCategories = ["gasoline", "diesel", "gas", "hydrogen", "electric", "other"];
    for (const ft of FUEL_TYPES) {
      expect(ft.label).toBeTruthy();
      expect(validCategories).toContain(ft.category);
    }
  });

  it("has no duplicate codes", () => {
    const codes = FUEL_TYPES.map((f) => f.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe("FUEL_TYPE_MAP", () => {
  it("maps all fuel type codes", () => {
    for (const ft of FUEL_TYPES) {
      expect(FUEL_TYPE_MAP.get(ft.code)).toBe(ft);
    }
  });

  it("returns undefined for unknown codes", () => {
    expect(FUEL_TYPE_MAP.get("UNKNOWN" as any)).toBeUndefined();
  });
});

describe("FUEL_CATEGORIES", () => {
  it("covers all categories used in FUEL_TYPES", () => {
    const usedCategories = new Set(FUEL_TYPES.map((f) => f.category));
    const definedCategories = new Set(FUEL_CATEGORIES.map((c) => c.key));
    for (const cat of usedCategories) {
      expect(definedCategories.has(cat), `category "${cat}" missing from FUEL_CATEGORIES`).toBe(true);
    }
  });

  it("each category has a label", () => {
    for (const cat of FUEL_CATEGORIES) {
      expect(cat.label).toBeTruthy();
    }
  });
});
