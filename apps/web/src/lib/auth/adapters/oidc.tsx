"use client";

import { UserManager, WebStorageStateStore, type User } from "oidc-client-ts";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
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
    um.getUser().then(apply, () => apply(null));
    return () => {
      cancelled = true;
      um.events.removeUserLoaded(onLoaded);
      um.events.removeUserUnloaded(onUnloaded);
    };
  }, []);

  const getToken = useCallback(async () => {
    const um = getOidcUserManager();
    const user = await um.getUser();
    if (user && !user.expired) return user.access_token;
    try {
      // Renews with a refresh token when the provider issued one.
      return (await um.signinSilent())?.access_token ?? null;
    } catch {
      return null;
    }
  }, []);
  const signIn = useCallback(async () => {
    await getOidcUserManager().signinRedirect();
  }, []);
  const signOut = useCallback(async () => {
    await getOidcUserManager().signoutRedirect();
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
