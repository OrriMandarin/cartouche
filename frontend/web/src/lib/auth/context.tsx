"use client";

import { createContext, useContext } from "react";
import type { AuthContextValue } from "./types";

export const AuthContext = createContext<AuthContextValue | null>(null);

/** spec: ACC-014. Access to the auth module, whichever adapter is configured. */
export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (value === null) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return value;
}
