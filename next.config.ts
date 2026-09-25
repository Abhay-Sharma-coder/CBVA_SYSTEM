import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev overlay badge sits on top of the UI and lands in every screenshot
  // taken for design review. Nothing depends on it.
  devIndicators: false,
  // Playwright drives the dev server over 127.0.0.1 rather than localhost.
  allowedDevOrigins: ["127.0.0.1"],
  // node-postgres reads `fs` for SSL material and optionally loads the native
  // bindings. Bundling it produces an unresolvable `fs` import and a stream of
  // `pg-native` warnings; leaving it external lets Node require it normally.
  // ADR-002 already rules out the edge runtime for database routes.
  serverExternalPackages: ["pg"],
};

export default nextConfig;
