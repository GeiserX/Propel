import { getConfig } from "@/lib/config";
import { HomeClient } from "@/components/home-client";
import { SUPPORTED_LOCALES, DEFAULT_LOCALE } from "@/lib/og-translations";
import type { Locale } from "@/lib/i18n";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ locale: string }>;
}

export default async function Home({ params }: Props) {
  const { locale: raw } = await params;
  const locale = (SUPPORTED_LOCALES.includes(raw as Locale) ? raw : DEFAULT_LOCALE) as Locale;
  const config = getConfig();

  return (
    <HomeClient
      defaultFuel={config.defaultFuel}
      center={config.center}
      zoom={config.zoom}
      clusterStations={config.clusterStations}
      locale={locale}
    />
  );
}
