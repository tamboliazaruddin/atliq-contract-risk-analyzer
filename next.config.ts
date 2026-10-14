import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse ships pdf.js workers that must not be bundled
  serverExternalPackages: ["pdf-parse", "mammoth"],
  // the dataset and derived knowledge base are read from disk at runtime (Vercel file tracing)
  outputFileTracingIncludes: {
    "/**": ["./data/**/*"],
  },
};

export default nextConfig;
