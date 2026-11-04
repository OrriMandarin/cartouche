export interface AuthUser {
  subject: string;
  email?: string;
  name?: string;
}

export interface AuthContextValue {
  status: "loading" | "signed-in" | "signed-out";
  user: AuthUser | null;
  /** Bearer token for the API, or `null` when signed out. */
  getToken(): Promise<string | null>;
  /** `subject` is only meaningful for the test adapter. Other adapters start their own flow. */
  signIn(opts?: { subject?: string }): Promise<void>;
  /**
   * Ends the session. `redirectTo` (a path of this site) is where the identity provider sends the browser back
   * afterwards; without it, the adapter's default (the home page). The test adapter ignores it.
   */
  signOut(opts?: { redirectTo?: string }): Promise<void>;
}
