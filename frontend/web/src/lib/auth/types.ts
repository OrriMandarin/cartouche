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
  signOut(): Promise<void>;
}
