"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { useMe } from "@/components/account/AccountGate";

/** spec: ADM-001. Renders its children for an administrator, « Accès réservé » for anyone else. Below an `<AccountGate>`. */
export function SupportGuard({ children }: { children: ReactNode }) {
  const t = useTranslations("support");
  const me = useMe();
  if (!me.is_admin) {
    return (
      <p data-testid="support-forbidden" className="text-muted-foreground py-10 text-center text-lg">
        {t("forbidden")}
      </p>
    );
  }
  return children;
}
