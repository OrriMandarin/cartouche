"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { Palette, QrCode, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, type ComponentType, type ReactNode } from "react";
import { LoginCardPreview } from "@/components/auth/LoginCardPreview";
import { BrandMark } from "@/components/shell/BrandMark";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth/context";
import { privacyUrl, termsUrl } from "@/lib/instance-links";

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

const ARGUMENTS = [
  { key: "tag", Icon: QrCode },
  { key: "page", Icon: Palette },
  { key: "contacts", Icon: Users },
] as const;

/** The frame of the sign-in block, the same as Clerk's card, for the sign-in that Clerk does not draw. */
function SignInFrame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      role="region"
      aria-label={label}
      className="bg-app-surface border-app-border rounded-app-xl shadow-app flex w-full max-w-[420px] flex-col items-center gap-5 border p-5 min-[600px]:p-8"
    >
      {children}
    </div>
  );
}

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
    body = (
      <SignInFrame label={t("login.frame")}>
        <TestLoginPanel />
      </SignInFrame>
    );
  } else if (ClerkSignIn !== null) {
    body = <ClerkSignIn />;
  } else {
    body = <OidcRedirect />;
  }

  const links = {
    terms: (chunks: ReactNode) => (
      <a href={termsUrl()} className="font-semibold text-app-text underline underline-offset-[3px]">
        {chunks}
      </a>
    ),
    privacy: (chunks: ReactNode) => (
      <a href={privacyUrl()} className="font-semibold text-app-text underline underline-offset-[3px]">
        {chunks}
      </a>
    ),
  };

  return (
    <main className="grid min-h-screen grid-cols-1 min-[600px]:grid-cols-2">
      <section className="min-[600px]:bg-app-surface-2 border-app-border relative flex flex-col gap-7 overflow-hidden px-5 pt-7 pb-6 min-[600px]:border-r min-[600px]:px-10 min-[600px]:py-12 min-[1000px]:px-14">
        <span className="font-app-display inline-flex items-center gap-2.5 text-[22px] leading-none font-semibold tracking-[-0.01em]">
          <BrandMark />
          {t("brand")}
        </span>
        <h1 className="font-app-display max-w-[13ch] text-[32px] leading-[1.08] font-semibold tracking-[-0.015em] min-[600px]:mt-6 min-[600px]:text-[46px] min-[600px]:leading-[1.05]">
          {t("login.tagline")}
        </h1>
        <ul className="hidden max-w-[28ch] flex-col gap-3 text-base min-[600px]:flex">
          {ARGUMENTS.map(({ key, Icon }) => (
            <li key={key} className="flex items-center gap-3">
              <Icon className="size-5 flex-none" aria-hidden="true" />
              {t(`login.arguments.${key}`)}
            </li>
          ))}
        </ul>
        <LoginCardPreview className="absolute top-[250px] right-14 hidden w-80 min-[1000px]:block" />
      </section>
      <section className="flex flex-col items-center justify-center gap-5 px-5 py-6 min-[600px]:px-10 min-[600px]:py-12">
        {body}
        <p className="text-app-muted max-w-[420px] text-center text-[13px] leading-[1.4]">
          {t.rich("login.legal", links)}
        </p>
      </section>
    </main>
  );
}
