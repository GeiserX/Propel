import { describe, it, expect } from "vitest";
import { LOCALES, type Locale } from "./i18n";

describe("LOCALES", () => {
  it("is a non-empty array", () => {
    expect(LOCALES.length).toBeGreaterThan(0);
  });

  it("all entries have required fields", () => {
    for (const l of LOCALES) {
      expect(l.code).toBeTruthy();
      expect(l.label).toBeTruthy();
      expect(l.flag).toBeTruthy();
    }
  });

  it("all codes are 2-letter lowercase strings", () => {
    for (const l of LOCALES) {
      expect(l.code).toMatch(/^[a-z]{2}$/);
    }
  });

  it("all flags are 2-letter uppercase strings", () => {
    for (const l of LOCALES) {
      expect(l.flag).toMatch(/^[A-Z]{2}$/);
    }
  });

  it("has no duplicate codes", () => {
    const codes = LOCALES.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("includes es and en", () => {
    const codes = LOCALES.map((l) => l.code);
    expect(codes).toContain("es");
    expect(codes).toContain("en");
  });

  it("es is the first locale", () => {
    expect(LOCALES[0].code).toBe("es");
    expect(LOCALES[0].label).toBe("Espa\u00f1ol");
    expect(LOCALES[0].flag).toBe("ES");
  });

  it("has at least 10 locales", () => {
    expect(LOCALES.length).toBeGreaterThanOrEqual(10);
  });

  it("all labels are non-empty native language names", () => {
    for (const l of LOCALES) {
      expect(l.label.length).toBeGreaterThan(2);
    }
  });
});
