"use client";

import { useTranslations } from "next-intl";
import { AccountGate, useMe } from "@/components/account/AccountGate";
import { DeleteAccount } from "@/components/account/DeleteAccount";

function AccountContent() {
  const t = useTranslations("account.page");
  const me = useMe();

  return (
    <section className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">{t("title")}</h1>
      <dl className="space-y-3">
        <div>
          <dt className="text-muted-foreground text-sm">{t("email")}</dt>
          <dd data-testid="account-email">{me.email}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-sm">{t("displayName")}</dt>
          <dd data-testid="account-display-name">{me.display_name ?? t("noDisplayName")}</dd>
        </div>
      </dl>
      <DeleteAccount isAdmin={me.is_admin} />
    </section>
  );
}

export default function AccountPage() {
  return (
    <AccountGate>
      <AccountContent />
    </AccountGate>
  );
}
