import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pumperly - Energy Route Planner",
  description:
    "Find the cheapest fuel and EV charging stations along your route. Real-time prices, smart detour calculations, and range-aware recommendations.",
  metadataBase: new URL("https://pumperly.com"),
  openGraph: {
    title: "Pumperly - Energy Route Planner",
    description:
      "Find the cheapest fuel & EV charging stations along your route. Real-time prices across 36 countries.",
    url: "https://pumperly.com",
    siteName: "Pumperly",
    type: "website",
    locale: "en_US",
    alternateLocale: [
      "es_ES",
      "fr_FR",
      "de_DE",
      "it_IT",
      "pt_PT",
      "pl_PL",
      "cs_CZ",
      "hu_HU",
      "bg_BG",
      "sk_SK",
      "da_DK",
      "sv_SE",
      "nb_NO",
      "sr_RS",
      "fi_FI",
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Pumperly - Energy Route Planner",
    description:
      "Find the cheapest fuel & EV charging stations along your route. Real-time prices across 36 countries.",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Pumperly",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0c111b",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("pumperly-theme");if(t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme:dark)").matches))document.documentElement.classList.add("dark")}catch(e){}})()`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
