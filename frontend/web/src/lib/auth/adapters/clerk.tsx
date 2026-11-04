"use client";

import { ClerkProvider, useAuth as useClerkAuth, useClerk, useUser } from "@clerk/nextjs";
import { useCallback, useMemo, type ReactNode } from "react";
import { AuthContext } from "../context";
import { clerkAppearance } from "../clerk-appearance";
import type { AuthContextValue } from "../types";

function ClerkBridge({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, getToken: getClerkToken } = useClerkAuth();
  const { user } = useUser();
  const clerk = useClerk();

  const getToken = useCallback(async () => (await getClerkToken()) ?? null, [getClerkToken]);
  const signIn = useCallback(async () => {
    // Hard navigation on purpose: adapters live outside any router context (unit tests, error boundaries).
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/login";
  }, []);
  const signOut = useCallback(
    async (opts?: { redirectTo?: string }) => {
      if (opts?.redirectTo) {
        await clerk.signOut({ redirectUrl: opts.redirectTo });
      } else {
        await clerk.signOut();
      }
    },
    [clerk],
  );

  const manageProfile = useCallback(() => clerk.openUserProfile(), [clerk]);

  const status: AuthContextValue["status"] = !isLoaded ? "loading" : isSignedIn ? "signed-in" : "signed-out";
  const email = user?.primaryEmailAddress?.emailAddress;
  const name = user?.fullName ?? undefined;
  const userId = user?.id;
  const provider = user?.externalAccounts?.[0]?.provider;

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user: status === "signed-in" && userId ? { subject: userId, email, name, provider } : null,
      getToken,
      signIn,
      signOut,
      manageProfile,
    }),
    [status, userId, email, name, provider, getToken, signIn, signOut, manageProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** spec: ACC-014. Default adapter. Client-side hooks only: no Clerk secret is needed at runtime. */
export function ClerkAuthAdapter({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider appearance={clerkAppearance}>
      <ClerkBridge>{children}</ClerkBridge>
    </ClerkProvider>
  );
}
