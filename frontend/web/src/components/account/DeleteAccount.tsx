"use client";

import { ApiError } from "@cartouche/api-client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ErrorNotice } from "@/components/ErrorNotice";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApi } from "@/lib/api";
import { isDeletionConfirmed } from "@/lib/account/deletion";

/**
 * spec: ACC-020, ACC-021, ACC-023. Deletes the signed-in account after a typed confirmation, then leaves for
 * /account-deleted with nothing else sent. An administrator only gets an explanation (ACC-021).
 */
export function DeleteAccount({ isAdmin }: { isAdmin: boolean }) {
  const t = useTranslations("account.delete");
  const router = useRouter();
  const api = useApi();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

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
    setError(null);
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await api.DELETE("/api/me");
    } catch (e) {
      // 404: the account is already gone (a double click), which is what was asked for.
      if (!(e instanceof ApiError && e.status === 404)) {
        setError(e);
        setBusy(false);
        return;
      }
    }
    router.replace("/account-deleted");
  }

  const refusedAsAdmin = error instanceof ApiError && error.code === "cannot_delete_admin";

  return (
    <>
      <Button variant="destructive" data-testid="delete-account-open" onClick={() => changeOpen(true)}>
        {t("open")}
      </Button>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent closeLabel={t("close")}>
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("consequences")}</DialogDescription>
          </DialogHeader>
          <p className="text-muted-foreground text-sm">{t("identityProvider")}</p>
          <div className="space-y-2">
            <Label htmlFor="delete-account-input">{t("inputLabel")}</Label>
            <Input
              id="delete-account-input"
              data-testid="delete-account-input"
              autoComplete="off"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </div>
          {refusedAsAdmin ? (
            <Alert variant="destructive" data-testid="delete-account-admin-refused">
              <AlertDescription>{t("adminRefused")}</AlertDescription>
            </Alert>
          ) : error !== null ? (
            <ErrorNotice error={error} />
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              data-testid="delete-account-cancel"
              disabled={busy}
              onClick={() => changeOpen(false)}
            >
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              data-testid="delete-account-confirm"
              disabled={busy || !isDeletionConfirmed(confirmation, t("confirmWord"))}
              onClick={() => void confirm()}
            >
              {t("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
