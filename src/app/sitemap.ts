import type { MetadataRoute } from "next";
import { SUPPORTED_LOCALES } from "@/lib/og-translations";

const BASE = "https://pumperly.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  return SUPPORTED_LOCALES.map((locale) => ({
    url: `${BASE}/${locale}`,
    lastModified: now,
    changeFrequency: "daily" as const,
    priority: 1.0,
    alternates: {
      languages: {
        ...Object.fromEntries(
          SUPPORTED_LOCALES.map((l) => [l, `${BASE}/${l}`]),
        ),
        "x-default": BASE,
      },
    },
  }));
}
