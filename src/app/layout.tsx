import type { Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0c111b",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const h = await headers();
  const lang = h.get("x-pumperly-locale") || "es";

  return (
    <html lang={lang} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("pumperly-theme");if(t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme:dark)").matches))document.documentElement.classList.add("dark")}catch(e){}})()`,
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebApplication",
              name: "Pumperly",
              url: "https://pumperly.com",
              description:
                "Find the cheapest fuel & EV charging stations along your route. Real-time prices across 36 countries.",
              applicationCategory: "TravelApplication",
              operatingSystem: "All",
              offers: {
                "@type": "Offer",
                price: "0",
                priceCurrency: "EUR",
              },
              inLanguage: [
                "es", "en", "fr", "de", "it", "pt", "pl", "cs",
                "hu", "bg", "sk", "da", "sv", "no", "sr", "fi",
              ],
              license: "https://www.gnu.org/licenses/gpl-3.0.html",
              isAccessibleForFree: true,
            }),
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
