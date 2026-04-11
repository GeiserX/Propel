import { describe, it, expect } from "vitest";
import { OG_TRANSLATIONS, SUPPORTED_LOCALES, DEFAULT_LOCALE } from "./og-translations";

describe("og-translations", () => {
  it("DEFAULT_LOCALE is es", () => {
    expect(DEFAULT_LOCALE).toBe("es");
  });

  it("SUPPORTED_LOCALES matches OG_TRANSLATIONS keys", () => {
    expect(SUPPORTED_LOCALES).toEqual(Object.keys(OG_TRANSLATIONS));
  });

  it("all locales have required OG fields", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const og = OG_TRANSLATIONS[locale];
      expect(og.title, `${locale}.title`).toBeTruthy();
      expect(og.description, `${locale}.description`).toBeTruthy();
      expect(og.imageSubtitle, `${locale}.imageSubtitle`).toBeTruthy();
      expect(og.ogLocale, `${locale}.ogLocale`).toMatch(/^[a-z]{2}_[A-Z]{2}$/);
    }
  });

  it("all titles contain Pumperly", () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(OG_TRANSLATIONS[locale].title).toContain("Pumperly");
    }
  });

  it("includes at least 10 locales", () => {
    expect(SUPPORTED_LOCALES.length).toBeGreaterThanOrEqual(10);
  });
});
