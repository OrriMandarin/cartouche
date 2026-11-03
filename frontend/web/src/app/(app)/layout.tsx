import { AuthProvider } from "@/lib/auth/AuthProvider";

// The identity provider (Clerk) only loads for the signed-in application: the public card page lives
// outside this group so a visitor on a slow connection never downloads it (PUB-001).
export default function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AuthProvider>{children}</AuthProvider>;
}
