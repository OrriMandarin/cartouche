"use client";

import { UserManager, WebStorageStateStore, type User } from "oidc-client-ts";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AuthContext } from "../context";
import type { AuthContextValue, AuthUser } from "../types";

let manager: UserManager | null = null;

/** Authorization Code + PKCE against the issuer given by NEXT_PUBLIC_OIDC_AUTHORITY / _CLIENT_ID. */
export function getOidcUserManager(): UserManager {
  if (manager === null) {
    const authority = process.env.NEXT_PUBLIC_OIDC_AUTHORITY;
    const clientId = process.env.NEXT_PUBLIC_OIDC_CLIENT_ID;
    if (!authority || !clientId) {
      throw new Error("NEXT_PUBLIC_OIDC_AUTHORITY and NEXT_PUBLIC_OIDC_CLIENT_ID are required for the oidc auth provider");
    }
    manager = new UserManager({
      authority,
      client_id: clientId,
      redirect_uri: `${window.location.origin}/auth/callback`,
      post_logout_redirect_uri: window.location.origin,
      response_type: "code",
      scope: "openid profile email",
      userStore: new WebStorageStateStore({ store: window.sessionStorage }),
      automaticSilentRenew: false,
    });
  }
  return manager;
}

/**
 * Renews the session silently (works with a refresh token only: no silent iframe is configured).
 * When that fails the user is removed, which fires `userUnloaded` and flips the adapter to signed-out.
 */
async function renewOrSignOut(um: UserManager): Promise<User | null> {
  try {
    // Another renewal may have finished since the caller read the user: do not spend the refresh token twice.
    const current = await um.getUser();
    if (current && !current.expired) return current;
    if (!current) return null;
    const renewed = await um.signinSilent();
    if (renewed) return renewed;
  } catch {
    // Fall through to the sign-out below.
  }
  try {
    await um.removeUser();
  } catch {
    // Nothing more to clean up.
  }
  return null;
}

let callbackPromise: Promise<void> | null = null;

/** Completes the redirect on /auth/callback. Idempotent, so React strict mode cannot consume the state twice. */
export function completeOidcSignIn(): Promise<void> {
  callbackPromise ??= getOidcUserManager()
    .signinRedirectCallback()
    .then(() => undefined);
  return callbackPromise;
}

function toAuthUser(user: User): AuthUser {
  return { subject: user.profile.sub, email: user.profile.email, name: user.profile.name };
}

export function OidcAuthAdapter({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ status: AuthContextValue["status"]; user: User | null }>({
    status: "loading",
    user: null,
  });

  // Single-flight renewal: with refresh-token rotation a second concurrent grant would fail and sign the user out.
  const renewing = useRef<Promise<User | null> | null>(null);
  const renew = useCallback((um: UserManager) => {
    renewing.current ??= renewOrSignOut(um).finally(() => {
      renewing.current = null;
    });
    return renewing.current;
  }, []);

  useEffect(() => {
    const um = getOidcUserManager();
    let cancelled = false;
    const apply = (user: User | null) => {
      if (!cancelled) setState({ status: user && !user.expired ? "signed-in" : "signed-out", user });
    };
    const onLoaded = (user: User) => apply(user);
    const onUnloaded = () => apply(null);
    um.events.addUserLoaded(onLoaded);
    um.events.addUserUnloaded(onUnloaded);
    const onTokenExpired = () => void renew(um);
    um.events.addAccessTokenExpired(onTokenExpired);
    um.getUser().then(apply, () => apply(null));
    return () => {
      cancelled = true;
      um.events.removeUserLoaded(onLoaded);
      um.events.removeUserUnloaded(onUnloaded);
      um.events.removeAccessTokenExpired(onTokenExpired);
    };
  }, [renew]);

  const getToken = useCallback(async () => {
    const um = getOidcUserManager();
    const user = await um.getUser();
    if (!user) return null;
    if (!user.expired) return user.access_token;
    // Renews with a refresh token when the provider issued one, otherwise signs the user out.
    return (await renew(um))?.access_token ?? null;
  }, [renew]);
  const signIn = useCallback(async () => {
    await getOidcUserManager().signinRedirect();
  }, []);
  const signOut = useCallback(async (opts?: { redirectTo?: string }) => {
    const um = getOidcUserManager();
    if (opts?.redirectTo) {
      await um.signoutRedirect({ post_logout_redirect_uri: `${window.location.origin}${opts.redirectTo}` });
    } else {
      await um.signoutRedirect();
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status: state.status,
      user: state.status === "signed-in" && state.user ? toAuthUser(state.user) : null,
      getToken,
      signIn,
      signOut,
    }),
    [state, getToken, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
