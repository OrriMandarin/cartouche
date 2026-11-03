"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/lib/auth/context";

/**
 * spec: ACC-023. Where the dashboard lands after the deletion of the account. Outside `AccountGate` on purpose:
 * it ends the session with the identity provider and sends no API request, which would recreate an empty account.
 */
export default function AccountDeletedPage() {
  const t = useTranslations("account.deleted");
  const { signOut } = useAuth();
  const signedOut = useRef(false);

  useEffect(() => {
    if (signedOut.current) return;
    signedOut.current = true;
    void signOut();
  }, [signOut]);

  return (
    <main className="mx-auto max-w-xl px-4 py-12">
      <Card data-testid="account-deleted">
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
          <p className="text-muted-foreground text-sm">{t("identityProvider")}</p>
          <div>
            <Button asChild variant="outline">
              <Link href="/" data-testid="account-deleted-home">
                {t("home")}
              </Link>
            </Button>
          </div>
        </CardHeader>
      </Card>
    </main>
  );
}
