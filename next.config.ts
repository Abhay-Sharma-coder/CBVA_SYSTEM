import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev overlay badge sits on top of the UI and lands in every screenshot
  // taken for design review. Nothing depends on it.
  devIndicators: false,
  // Playwright drives the dev server over 127.0.0.1 rather than localhost.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
