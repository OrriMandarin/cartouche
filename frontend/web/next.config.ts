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
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiInternalUrl}/api/:path*` }];
  },
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(nextConfig);
