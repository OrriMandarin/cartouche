"use client";

import { useCallback, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { AuthContext } from "../context";
import { findBaseTestUser } from "../test-users";
import type { AuthContextValue, AuthUser } from "../types";

const TOKEN_KEY = "cartouche.test.token";
const SUBJECT_KEY = "cartouche.test.subject";

interface Session {
  token: string;
  user: AuthUser;
}

function userFor(subject: string): AuthUser {
  const known = findBaseTestUser(subject);
  return known ? { subject, email: known.email, name: known.name } : { subject };
}

// The session lives in sessionStorage (so it survives reloads but not tabs). It is exposed through an
// external store, which keeps server and first client render at "loading" without effect-driven setState.
const listeners = new Set<() => void>();
let memorySession: string | null = null; // only used when sessionStorage is unavailable

function readRaw(): string | null {
  try {
    const token = sessionStorage.getItem(TOKEN_KEY);
    const subject = sessionStorage.getItem(SUBJECT_KEY);
    return token && subject ? JSON.stringify([token, subject]) : null;
  } catch {
    return memorySession;
  }
}

function writeSession(session: { token: string; subject: string } | null): void {
  memorySession = session ? JSON.stringify([session.token, session.subject]) : null;
  try {
    if (session) {
      sessionStorage.setItem(TOKEN_KEY, session.token);
      sessionStorage.setItem(SUBJECT_KEY, session.subject);
    } else {
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(SUBJECT_KEY);
    }
  } catch {
    // Storage unavailable: the in-memory copy is all there is.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function parseSession(raw: string): Session {
  const [token, subject] = JSON.parse(raw) as [string, string];
  return { token, user: userFor(subject) };
}

/** spec: ACC-015. Signs in against the local fake issuer (`POST /api/test/token`). */
export function TestAuthAdapter({ children }: { children: ReactNode }) {
  // `undefined` on the server: the session is unknown until the client has read the storage.
  const raw = useSyncExternalStore<string | null | undefined>(subscribe, readRaw, () => undefined);
  const session = useMemo(() => (raw ? parseSession(raw) : null), [raw]);
  const status: AuthContextValue["status"] = raw === undefined ? "loading" : session ? "signed-in" : "signed-out";

  const signIn = useCallback(async (opts?: { subject?: string }) => {
    const subject = opts?.subject?.trim().normalize("NFC");
    if (!subject) {
      // Hard navigation on purpose: adapters live outside any router context (unit tests, error boundaries).
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/login";
      return;
    }
    const known = findBaseTestUser(subject);
    const response = await fetch("/api/test/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(known ? { subject, email: known.email, name: known.name } : { subject }),
    });
    if (!response.ok) {
      throw new Error(`Test token request failed with status ${response.status}`);
    }
    const body = (await response.json()) as { token?: unknown };
    if (typeof body.token !== "string" || body.token === "") {
      throw new Error("Test token response has no token");
    }
    writeSession({ token: body.token, subject });
  }, []);

  const signOut = useCallback(async () => {
    writeSession(null);
  }, []);

  const token = session?.token ?? null;
  const getToken = useCallback(async () => token, [token]);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user: session?.user ?? null, getToken, signIn, signOut }),
    [status, session, getToken, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
