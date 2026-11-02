import { useTranslations } from "next-intl";
import type { BuildProfile } from "@/lib/build-profile";

/** True for the profiles in which the test-mode banner is shown. */
export function isTestModeProfile(profile: BuildProfile | string | undefined): boolean {
  return profile === "development" || profile === "test";
}

/**
 * spec: ACC-009. Permanent banner shown in the development and test build profiles.
 * The profile defaults to the value inlined at build time by next.config.ts.
 */
export function TestModeBanner({
  profile = process.env.NEXT_PUBLIC_CARTOUCHE_BUILD_PROFILE,
}: {
  profile?: BuildProfile | string;
}) {
  const t = useTranslations();

  if (!isTestModeProfile(profile)) {
    return null;
  }

  return (
    <div
      role="status"
      data-testid="test-mode-banner"
      className="fixed inset-x-0 top-0 z-50 bg-yellow-400 px-2 py-0.5 text-center text-xs font-bold tracking-wide text-black"
    >
      {t("testMode.banner")}
    </div>
  );
}
