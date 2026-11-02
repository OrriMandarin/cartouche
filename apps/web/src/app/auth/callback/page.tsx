"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

/** OIDC redirect target (Authorization Code + PKCE). Other providers never land here. */
export default function AuthCallbackPage() {
  const t = useTranslations("auth.callback");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_AUTH_PROVIDER !== "oidc") {
      window.location.replace("/");
      return;
    }
    import("@/lib/auth/adapters/oidc")
      .then((m) => m.completeOidcSignIn())
      // Full navigation so the auth provider in the layout reloads the stored user.
      .then(() => window.location.replace("/"))
      .catch(() => setFailed(true));
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-4 px-4 text-center">
      {failed ? (
        <>
          <p role="alert">{t("error")}</p>
          <Button asChild>
            <a href="/login">{t("retry")}</a>
          </Button>
        </>
      ) : (
        <p>{t("pending")}</p>
      )}
    </main>
  );
}
