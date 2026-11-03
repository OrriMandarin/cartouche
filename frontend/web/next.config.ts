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
  experimental: {
    // Next proxies `/api/*` to the API and, by default, keeps only the first 10 MB of a request body: a video
    // upload (25 MB, plus its poster) would reach the API truncated. The API's own limit is 36 MiB.
    proxyClientMaxBodySize: "40mb",
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
