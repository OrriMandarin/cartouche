"use client";

import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { DeleteAccount, type AccountTotals } from "@/components/account/DeleteAccount";
import { Button } from "@/components/ui/button";

/**
 * spec: ACC-021, ACC-027. The danger zone of the account page: what the deletion removes, in numbers, the way to
 * export the contacts first, and the deletion itself. An administrator only reads why there is no deletion.
 */
export function DeletionZone({ isAdmin, totals }: { isAdmin: boolean; totals: AccountTotals }) {
  const t = useTranslations("account.delete");
  return (
    <section
      aria-labelledby="delete-account-title"
      data-testid="delete-account-zone"
      className="bg-app-surface border-app-danger/30 rounded-app-lg shadow-app-sm flex flex-col gap-4 border p-4 @min-[600px]:p-6"
    >
      <h2 id="delete-account-title" className="text-app-danger text-base leading-[1.35] font-[650]">
        {t("zoneTitle")}
      </h2>
      {isAdmin ? (
        <DeleteAccount isAdmin totals={totals} />
      ) : (
        <>
          <p data-testid="delete-account-summary">
            {t.rich("summary", { ...totals, b: (chunks) => <b>{chunks}</b> })}
          </p>
          <div className="flex flex-wrap items-center gap-4 @max-[599px]:flex-col @max-[599px]:items-stretch">
            <Button asChild variant="secondary">
              <Link href="/dashboard/contacts" data-testid="delete-account-export">
                <Download aria-hidden="true" />
                {t("exportFirst")}
              </Link>
            </Button>
            <DeleteAccount isAdmin={false} totals={totals} />
          </div>
        </>
      )}
    </section>
  );
}
