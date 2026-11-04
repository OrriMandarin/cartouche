"use client";

import { ClerkProvider, useAuth as useClerkAuth, useClerk, useUser } from "@clerk/nextjs";
import { useCallback, useMemo, type ReactNode } from "react";
import { AuthContext } from "../context";
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

  const status: AuthContextValue["status"] = !isLoaded ? "loading" : isSignedIn ? "signed-in" : "signed-out";
  const email = user?.primaryEmailAddress?.emailAddress;
  const name = user?.fullName ?? undefined;
  const userId = user?.id;

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user: status === "signed-in" && userId ? { subject: userId, email, name } : null,
      getToken,
      signIn,
      signOut,
    }),
    [status, userId, email, name, getToken, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** spec: ACC-014. Default adapter. Client-side hooks only: no Clerk secret is needed at runtime. */
export function ClerkAuthAdapter({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider>
      <ClerkBridge>{children}</ClerkBridge>
    </ClerkProvider>
  );
}
