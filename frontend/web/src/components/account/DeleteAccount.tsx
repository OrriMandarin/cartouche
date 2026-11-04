"use client";

import type { components } from "@cartouche/api-client";
import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ErrorNotice } from "@/components/ErrorNotice";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApi } from "@/lib/api";
import { deletionOutcome, isDeletionConfirmed, type DeletionOutcome } from "@/lib/account/deletion";

export type AccountTotals = components["schemas"]["AccountTotals"];

/**
 * spec: ACC-020, ACC-021, ACC-023, ACC-027. Deletes the signed-in account after a typed confirmation that lists what
 * disappears, then leaves for /account-deleted with nothing else sent. An administrator only gets an explanation
 * (ACC-021). On a phone the confirmation is a sheet from the bottom.
 */
export function DeleteAccount({
  isAdmin,
  totals,
  triggerClassName,
}: {
  isAdmin: boolean;
  totals: AccountTotals;
  triggerClassName?: string;
}) {
  const t = useTranslations("account.delete");
  const router = useRouter();
  const api = useApi();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<DeletionOutcome | null>(null);

  if (isAdmin) {
    return (
      <p data-testid="delete-account-admin" className="text-muted-foreground text-sm">
        {t("admin")}
      </p>
    );
  }

  function changeOpen(next: boolean) {
    if (busy) return;
    setOpen(next);
    setConfirmation("");
    setOutcome(null);
  }

  async function confirm() {
    setBusy(true);
    setOutcome(null);
    let failure: unknown = null;
    try {
      await api.DELETE("/api/me");
    } catch (e) {
      failure = e;
    }
    const result = deletionOutcome(failure);
    if (result.kind === "deleted") {
      router.replace("/account-deleted");
      return;
    }
    setOutcome(result);
    setBusy(false);
  }

  return (
    <>
      <Button variant="destructive" data-testid="delete-account-open" className={triggerClassName} onClick={() => changeOpen(true)}>
        <Trash2 aria-hidden="true" />
        {t("open")}
      </Button>
      <AlertDialog open={open} onOpenChange={changeOpen}>
        <AlertDialogContent className="max-[599px]:top-auto max-[599px]:bottom-0 max-[599px]:max-w-none max-[599px]:translate-y-0 max-[599px]:rounded-b-none max-[599px]:px-5 max-[599px]:pb-7 min-[600px]:max-w-[520px]">
          <div aria-hidden="true" className="bg-app-danger-soft text-app-danger grid size-11 place-items-center rounded-full">
            <Trash2 className="size-5" />
          </div>
          <AlertDialogTitle>{t("title")}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="text-app-text flex flex-col gap-2.5">
              <p>{t("intro")}</p>
              <ul className="flex list-disc flex-col gap-1.5 pl-5">
                <li>{t("listCards", { count: totals.cards })}</li>
                <li>{t("listEvents", { count: totals.events })}</li>
                <li>{t("listLeads", { count: totals.leads })}</li>
              </ul>
              <p className="text-app-muted text-sm">{t("consequences")}</p>
              <p className="text-app-muted text-sm">{t("identityProvider")}</p>
            </div>
          </AlertDialogDescription>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="delete-account-input">
              {t.rich("inputLabel", {
                word: t("confirmWord"),
                code: (chunks) => (
                  <span className="bg-app-surface-2 rounded-[4px] px-1.5 py-px font-mono text-sm">{chunks}</span>
                ),
              })}
            </Label>
            <Input
              id="delete-account-input"
              data-testid="delete-account-input"
              className="font-mono"
              autoComplete="off"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </div>
          {outcome?.kind === "admin" ? (
            <Alert variant="destructive" data-testid="delete-account-admin-refused">
              <AlertDescription>{t("adminRefused")}</AlertDescription>
            </Alert>
          ) : outcome?.kind === "failed" ? (
            <ErrorNotice error={outcome.error} />
          ) : null}
          <AlertDialogFooter className="max-[599px]:flex-col-reverse max-[599px]:[&>button]:w-full">
            <AlertDialogCancel data-testid="delete-account-cancel" disabled={busy}>
              {t("cancel")}
            </AlertDialogCancel>
            <Button
              variant="destructive"
              data-testid="delete-account-confirm"
              disabled={busy || !isDeletionConfirmed(confirmation, t("confirmWord"))}
              onClick={() => void confirm()}
            >
              {t("confirm")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
