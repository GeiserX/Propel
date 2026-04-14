import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Pumperly",
    short_name: "Pumperly",
    description:
      "Find the cheapest fuel & EV charging stations along your route. Real-time prices across 36 countries.",
    start_url: "/",
    display: "standalone",
    background_color: "#0c111b",
    theme_color: "#0c111b",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
