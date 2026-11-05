"use client";

import { TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { LeaveGuard } from "@/lib/leave-guard";

/**
 * spec: EDI-028. « Quitter sans enregistrer ? »: Rester (focused first), Quitter sans enregistrer,
 * Enregistrer et quitter. On a phone it sits at the bottom of the screen like a sheet. `phoneDescription`
 * replaces `description` there when given.
 */
export function LeaveDialog({
  guard,
  description,
  phoneDescription,
  canSave = true,
}: {
  guard: LeaveGuard;
  description: ReactNode;
  phoneDescription?: ReactNode;
  /** False when the draft cannot be saved right now (upload in flight, refused address): « Enregistrer et quitter » waits. */
  canSave?: boolean;
}) {
  const t = useTranslations("leaveDialog");
  return (
    <AlertDialog open={guard.asking} onOpenChange={(open) => (open || guard.saving ? undefined : guard.stay())}>
      <AlertDialogContent
        data-testid="leave-dialog"
        className="max-[847px]:top-auto max-[847px]:bottom-0 max-[847px]:left-0 max-[847px]:max-w-none max-[847px]:translate-x-0 max-[847px]:translate-y-0 max-[847px]:rounded-b-none"
      >
        <div
          aria-hidden="true"
          className="bg-app-warning-soft text-app-warning grid size-11 place-items-center rounded-full max-[847px]:hidden"
        >
          <TriangleAlert className="size-5" />
        </div>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {phoneDescription ? (
              <>
                <span className="max-[847px]:hidden">{description}</span>
                <span className="hidden max-[847px]:inline">{phoneDescription}</span>
              </>
            ) : (
              description
            )}
          </AlertDialogDescription>
          {canSave ? null : (
            <p data-testid="leave-cannot-save" className="text-app-muted text-[15px] leading-normal">
              {t("cannotSave")}
            </p>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter className="max-[847px]:flex-col-reverse max-[847px]:[&>*]:w-full">
          <AlertDialogCancel data-testid="leave-stay" disabled={guard.saving}>
            {t("stay")}
          </AlertDialogCancel>
          <Button
            type="button"
            variant="secondary"
            className="text-app-danger"
            data-testid="leave-discard"
            disabled={guard.saving}
            onClick={guard.leave}
          >
            {t("discard")}
          </Button>
          <Button
            type="button"
            data-testid="leave-save"
            disabled={guard.saving || !canSave}
            onClick={() => void guard.saveAndLeave()}
          >
            {guard.saving ? t("saving") : t("saveAndLeave")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
