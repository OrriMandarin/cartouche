"use client";

import dynamic from "next/dynamic";
import type { ComponentType, ReactNode } from "react";

type AdapterComponent = ComponentType<{ children: ReactNode }>;

/*
 * Adapter selection happens once per module load.
 *
 * Every condition below is written out with literal `process.env.NEXT_PUBLIC_*` reads on purpose:
 * the bundler inlines them at build time, folds the branches and drops the unused `import()` calls.
 * That is what keeps the test adapter (and its storage keys) out of production bundles (spec: ACC-008).
 * Do not hoist these expressions into shared constants or helpers: the folding would stop working.
 */
const Adapter: AdapterComponent | null =
  process.env.NEXT_PUBLIC_AUTH_PROVIDER === "test"
    ? process.env.NEXT_PUBLIC_CARTOUCHE_BUILD_PROFILE !== "production"
      ? dynamic(() => import("./adapters/test").then((m) => m.TestAuthAdapter))
      : null
    : process.env.NEXT_PUBLIC_AUTH_PROVIDER === "oidc"
      ? dynamic(() => import("./adapters/oidc").then((m) => m.OidcAuthAdapter))
      : dynamic(() => import("./adapters/clerk").then((m) => m.ClerkAuthAdapter));

/** spec: ACC-014. Provides the auth context using the adapter chosen by NEXT_PUBLIC_AUTH_PROVIDER. */
export function AuthProvider({ children }: { children: ReactNode }) {
  if (Adapter === null) {
    throw new Error("The test auth provider is not available in the production build profile");
  }
  return <Adapter>{children}</Adapter>;
}
