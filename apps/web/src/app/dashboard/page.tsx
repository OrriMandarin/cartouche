"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { AccountGate, useMe } from "@/components/account/AccountGate";
import { Button } from "@/components/ui/button";

function DashboardContent() {
  const t = useTranslations("dashboard");
  const me = useMe();

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-bold tracking-tight">{t("title")}</h1>
        {me.is_admin ? (
          <Button asChild variant="outline">
            <Link href="/support" data-testid="nav-support">
              {t("support")}
            </Link>
          </Button>
        ) : null}
      </div>
      <p data-testid="dashboard-empty" className="text-muted-foreground rounded-lg border border-dashed p-10 text-center">
        {t("empty")}
      </p>
    </section>
  );
}

export default function DashboardPage() {
  return (
    <AccountGate>
      <DashboardContent />
    </AccountGate>
  );
}
