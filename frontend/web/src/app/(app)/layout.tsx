import { Toaster } from "@/components/ui/toaster";
import { AuthProvider } from "@/lib/auth/AuthProvider";

// The identity provider (Clerk) only loads for the signed-in application: the public card page lives
// outside this group so a visitor on a slow connection never downloads it (PUB-001).
// The app font and colors are set here, never on `body`, which the public card page also uses.
export default function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <AuthProvider>
      <div className="font-app bg-app-bg text-app-text min-h-screen">{children}</div>
      <Toaster />
    </AuthProvider>
  );
}
