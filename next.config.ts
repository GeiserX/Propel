import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Caddy handles compression — disabling here prevents Next.js from
  // buffering ReadableStream responses (breaks NDJSON streaming).
  compress: false,
};

export default nextConfig;
