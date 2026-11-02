"use client";

import { ApiError } from "@cartouche/api-client";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/** Generic error message that always carries the request id, so a user can quote it to the support. */
export function ErrorNotice({ error }: { error: unknown }) {
  const t = useTranslations("account.error");
  const requestId = error instanceof ApiError ? error.requestId : null;

  return (
    <Alert variant="destructive" data-testid="error-notice">
      <AlertTitle>{t("title")}</AlertTitle>
      <AlertDescription>
        <p>{t("message")}</p>
        {requestId ? (
          <p>
            {t("requestId")} <span data-testid="error-request-id">{requestId}</span>
          </p>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
