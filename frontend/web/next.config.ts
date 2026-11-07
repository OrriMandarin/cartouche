import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { resolveApiInternalUrl, resolveBuildConfig } from "./src/lib/build-profile";

// Fails the build when the combination is invalid (spec: ACC-008).
const { profile } = resolveBuildConfig({
  profile: process.env.CARTOUCHE_BUILD_PROFILE,
  authProvider: process.env.NEXT_PUBLIC_AUTH_PROVIDER,
});

const apiInternalUrl = resolveApiInternalUrl(profile, process.env.API_INTERNAL_URL);

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@cartouche/api-client"],
  env: {
    NEXT_PUBLIC_CARTOUCHE_BUILD_PROFILE: profile,
  },
  // `next dev` refuses the scripts and the HMR socket of any origin other than localhost (403): a phone on the
  // local network would stay on the server-rendered "Chargement…" page, never hydrated. Home and office LANs.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*"],
  experimental: {
    // Next proxies `/api/*` to the API and, by default, keeps only the first 10 MB of a request body: a video
    // upload (50 MB, MED-002) would reach the API truncated. The API's own limit is 52 MiB.
    proxyClientMaxBodySize: "56mb",
    // A video upload waits for its transcode (up to 120 s, MED-039) as well as for its transfer; the default
    // proxy timeout (30 s) would cut the request first.
    proxyTimeout: 180_000,
  },
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${apiInternalUrl}/api/:path*` },
      // Card media, served by the API in `local` storage mode.
      { source: "/media/:path*", destination: `${apiInternalUrl}/media/:path*` },
    ];
  },
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(nextConfig);
