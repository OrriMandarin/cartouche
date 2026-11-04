"use client";

import { useTranslations } from "next-intl";
import { AccountGate, useMe } from "@/components/account/AccountGate";
import { DeleteAccount } from "@/components/account/DeleteAccount";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth/context";

function AccountContent() {
  const t = useTranslations("account.page");
  const me = useMe();
  const { signOut } = useAuth();
  const shell = useTranslations("shell");

  return (
    <section className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">{t("title")}</h1>
      <dl className="space-y-3">
        <div>
          <dt className="text-muted-foreground text-sm">{t("email")}</dt>
          <dd data-testid="account-email">{me.email ?? t("notProvided")}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-sm">{t("displayName")}</dt>
          <dd data-testid="account-display-name">{me.display_name ?? t("notProvided")}</dd>
        </div>
      </dl>
      {/* On a phone the side bar, which holds the sign-out, is not there. */}
      <Button variant="outline" data-testid="account-sign-out" className="@min-[848px]:hidden" onClick={() => void signOut()}>
        {shell("signOut")}
      </Button>
      <DeleteAccount isAdmin={me.is_admin} />
    </section>
  );
}

export default function AccountPage() {
  const t = useTranslations("shell");
  return (
    <AccountGate title={t("account")}>
      <AccountContent />
    </AccountGate>
  );
}
