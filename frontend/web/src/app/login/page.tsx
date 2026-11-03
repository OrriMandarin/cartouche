"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, type ComponentType } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth/context";

// Same literal build-time conditions as AuthProvider.tsx: the test login UI must not reach production bundles.
const TestLoginPanel: ComponentType | null =
  process.env.NEXT_PUBLIC_AUTH_PROVIDER === "test"
    ? process.env.NEXT_PUBLIC_CARTOUCHE_BUILD_PROFILE !== "production"
      ? dynamic(() => import("@/lib/auth/TestLoginPanel").then((m) => m.TestLoginPanel))
      : null
    : null;

// Hash routing keeps the sign-in widget on /login without a catch-all route.
const ClerkSignIn: ComponentType | null =
  process.env.NEXT_PUBLIC_AUTH_PROVIDER === "test" || process.env.NEXT_PUBLIC_AUTH_PROVIDER === "oidc"
    ? null
    : dynamic(() =>
        import("@clerk/nextjs").then((m) => {
          const SignIn = m.SignIn;
          return function ClerkSignInWidget() {
            return <SignIn routing="hash" fallbackRedirectUrl="/dashboard" />;
          };
        }),
      );

function OidcRedirect() {
  const t = useTranslations("auth");
  const { signIn } = useAuth();
  useEffect(() => {
    void signIn();
  }, [signIn]);
  return <p>{t("login.redirecting")}</p>;
}

export default function LoginPage() {
  const t = useTranslations("auth");
  const { status, user, signOut } = useAuth();
  const router = useRouter();

  // spec: ACC-001. A signed-in visitor goes straight to the dashboard.
  useEffect(() => {
    if (status === "signed-in") router.replace("/dashboard");
  }, [status, router]);

  let body;
  if (status === "loading") {
    body = <p>{t("login.loading")}</p>;
  } else if (status === "signed-in") {
    body = (
      <div className="flex flex-col items-center gap-4" data-testid="login-signed-in">
        <p>{t("login.signedInAs", { name: user?.name ?? user?.email ?? user?.subject ?? "" })}</p>
        <p>
          {t("login.toDashboard")}{" "}
          <Link href="/dashboard" className="underline" data-testid="login-to-dashboard">
            {t("login.dashboardLink")}
          </Link>
        </p>
        <Button variant="outline" data-testid="sign-out" onClick={() => void signOut()}>
          {t("login.signOut")}
        </Button>
      </div>
    );
  } else if (TestLoginPanel !== null) {
    body = <TestLoginPanel />;
  } else if (ClerkSignIn !== null) {
    body = <ClerkSignIn />;
  } else {
    body = <OidcRedirect />;
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-6 px-4 py-16 text-center">
      <h1 className="text-3xl font-bold tracking-tight">{t("login.title")}</h1>
      {body}
    </main>
  );
}
