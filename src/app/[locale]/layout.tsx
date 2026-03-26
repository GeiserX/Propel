import type { Metadata } from "next";
import type { Locale } from "@/lib/i18n";
import {
  OG_TRANSLATIONS,
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
} from "@/lib/og-translations";

interface Props {
  params: Promise<{ locale: string }>;
  children: React.ReactNode;
}

export async function generateStaticParams() {
  return SUPPORTED_LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale = (
    SUPPORTED_LOCALES.includes(raw as Locale) ? raw : DEFAULT_LOCALE
  ) as Locale;

  const og = OG_TRANSLATIONS[locale];

  const alternateLocales = SUPPORTED_LOCALES.filter((l) => l !== locale).map(
    (l) => OG_TRANSLATIONS[l].ogLocale,
  );

  const languages: Record<string, string> = {};
  for (const l of SUPPORTED_LOCALES) {
    const href =
      l === DEFAULT_LOCALE
        ? "https://pumperly.com"
        : `https://pumperly.com/${l}`;
    languages[l] = href;
  }
  languages["x-default"] = "https://pumperly.com";

  return {
    title: og.title,
    description: og.description,
    metadataBase: new URL("https://pumperly.com"),
    alternates: {
      canonical:
        locale === DEFAULT_LOCALE
          ? "https://pumperly.com"
          : `https://pumperly.com/${locale}`,
      languages,
    },
    openGraph: {
      title: og.title,
      description: og.description,
      url:
        locale === DEFAULT_LOCALE
          ? "https://pumperly.com"
          : `https://pumperly.com/${locale}`,
      siteName: "Pumperly",
      type: "website",
      locale: og.ogLocale,
      alternateLocale: alternateLocales,
    },
    twitter: {
      card: "summary_large_image",
      title: og.title,
      description: og.description,
    },
    appleWebApp: {
      capable: true,
      statusBarStyle: "black-translucent",
      title: "Pumperly",
    },
  };
}

export default function LocaleLayout({ children }: Props) {
  return children;
}
