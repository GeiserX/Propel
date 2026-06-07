import { describe, it, expect } from "vitest";
import { CURRENCIES, isValidExchangeRates, type Currency, type CurrencyInfo } from "./currency";

describe("CURRENCIES", () => {
  it("is a non-empty array", () => {
    expect(CURRENCIES.length).toBeGreaterThan(0);
  });

  it("all entries have required fields", () => {
    for (const c of CURRENCIES) {
      expect(c.code).toBeTruthy();
      expect(c.symbol).toBeTruthy();
      expect(c.label).toBeTruthy();
      expect(typeof c.decimals).toBe("number");
      expect(c.decimals).toBeGreaterThanOrEqual(0);
    }
  });

  it("has no duplicate codes", () => {
    const codes = CURRENCIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("all codes are 3-letter uppercase strings", () => {
    for (const c of CURRENCIES) {
      expect(c.code).toMatch(/^[A-Z]{3}$/);
    }
  });

  it("includes EUR as the first entry", () => {
    expect(CURRENCIES[0].code).toBe("EUR");
    expect(CURRENCIES[0].symbol).toBe("\u20ac");
  });

  it("includes major world currencies", () => {
    const codes = CURRENCIES.map((c) => c.code);
    expect(codes).toContain("EUR");
    expect(codes).toContain("USD");
    expect(codes).toContain("GBP");
    expect(codes).toContain("JPY");
    expect(codes).toContain("CHF");
    expect(codes).toContain("CAD");
  });

  it("decimals are between 0 and 3", () => {
    for (const c of CURRENCIES) {
      expect(c.decimals).toBeGreaterThanOrEqual(0);
      expect(c.decimals).toBeLessThanOrEqual(3);
    }
  });

  it("zero-decimal currencies have decimals=0", () => {
    const zeroDecimal = CURRENCIES.filter((c) =>
      ["JPY", "ISK", "HUF", "RSD", "MKD", "KRW", "IDR", "ARS"].includes(c.code),
    );
    for (const c of zeroDecimal) {
      expect(c.decimals, `${c.code} should have 0 decimals`).toBe(0);
    }
  });

  it("has at least 30 currencies", () => {
    expect(CURRENCIES.length).toBeGreaterThanOrEqual(30);
  });
});

describe("isValidExchangeRates", () => {
  it("accepts a well-formed payload", () => {
    expect(
      isValidExchangeRates({ base: "EUR", rates: { USD: 1.1 }, date: "2026-06-07" }),
    ).toBe(true);
  });

  it("rejects payload with missing date", () => {
    expect(isValidExchangeRates({ base: "EUR", rates: { USD: 1.1 } })).toBe(false);
  });

  it("rejects payload with non-string date", () => {
    expect(
      isValidExchangeRates({ base: "EUR", rates: { USD: 1.1 }, date: 12345 }),
    ).toBe(false);
  });

  it("rejects payload with missing rates object", () => {
    expect(isValidExchangeRates({ base: "EUR", date: "2026-06-07" })).toBe(false);
  });

  it("rejects payload with missing base", () => {
    expect(isValidExchangeRates({ rates: { USD: 1.1 }, date: "2026-06-07" })).toBe(false);
  });

  it("rejects null and non-object values", () => {
    expect(isValidExchangeRates(null)).toBe(false);
    expect(isValidExchangeRates(undefined)).toBe(false);
    expect(isValidExchangeRates("nope")).toBe(false);
  });
});
