"use client";

import { LogOut, Settings } from "lucide-react";
import { useTranslations } from "next-intl";
import { AccountGate, useMe } from "@/components/account/AccountGate";
import { DeletionZone } from "@/components/account/DeletionZone";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth/context";
import { signInProviderLabel } from "@/lib/auth/provider-label";

function AccountContent() {
  const t = useTranslations("account.page");
  const shell = useTranslations("shell");
  const me = useMe();
  const { signOut, manageProfile, user } = useAuth();
  const name = me.display_name ?? t("notProvided");
  const provider = signInProviderLabel(user?.provider);

  return (
    <div className="flex max-w-[820px] flex-col gap-5">
      <h1 className="hidden text-[28px] leading-[1.2] font-bold tracking-[-0.02em] @min-[848px]:block">{t("title")}</h1>
      <section
        aria-labelledby="account-profile-title"
        className="bg-app-surface border-app-border rounded-app-lg shadow-app-sm flex flex-col gap-4 border p-4 @min-[600px]:p-6"
      >
        <h2 id="account-profile-title" className="text-base leading-[1.35] font-[650]">
          {t("profile")}
        </h2>
        <div className="flex items-center gap-3.5">
          <span
            aria-hidden="true"
            className="bg-app-surface-2 grid size-14 flex-none place-items-center rounded-full text-xl font-semibold"
          >
            {Array.from(name)[0]?.toUpperCase() ?? ""}
          </span>
          <div className="min-w-0">
            <b data-testid="account-display-name" className="block text-[17px]">
              {name}
            </b>
            <span data-testid="account-email" className="text-app-muted block break-words">
              {me.email ?? t("notProvided")}
            </span>
            {provider ? (
              <span data-testid="account-sign-in-provider" className="text-app-muted block text-[13px]">
                {t("signedInWith", { provider })}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4 @max-[599px]:flex-col @max-[599px]:items-stretch">
          {manageProfile ? (
            <Button variant="secondary" data-testid="account-manage-profile" onClick={manageProfile}>
              <Settings aria-hidden="true" />
              {t("manageProfile")}
            </Button>
          ) : null}
          <Button variant="secondary" data-testid="account-sign-out" onClick={() => void signOut()}>
            <LogOut aria-hidden="true" />
            {shell("signOut")}
          </Button>
        </div>
      </section>
      <DeletionZone isAdmin={me.is_admin} totals={me.totals} />
    </div>
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
