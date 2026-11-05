"use client";

import { AlertCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Fragment } from "react";
import type { ErrorField } from "@/lib/cards/error-fields";

/**
 * spec: EDI-027, EDI-015. After a refused save: nothing was saved, how many points to fix, and a link to each
 * field. `onJump` brings the field into view (unfolding its section on a phone) and gives it the focus.
 */
export function ErrorSummary({ fields, onJump }: { fields: ErrorField[]; onJump: (field: ErrorField) => void }) {
  const t = useTranslations();
  if (fields.length === 0) return null;
  return (
    <div
      role="alert"
      data-testid="editor-error-summary"
      className="bg-app-danger-soft rounded-app flex items-start gap-3 px-4 py-3.5 text-sm leading-[1.45]"
    >
      <AlertCircle aria-hidden="true" className="text-app-danger mt-px size-5 flex-none" />
      <p>
        <b>{t("editor.errorSummary", { count: fields.length })}</b>{" "}
        {fields.map((field, index) => (
          <Fragment key={field.path}>
            {index > 0 ? " · " : null}
            <a
              href={`#${field.targetId}`}
              onClick={(event) => {
                event.preventDefault();
                onJump(field);
              }}
              className="font-semibold underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-ring)]"
            >
              {t(field.label.key, field.label.values)}
            </a>
          </Fragment>
        ))}
      </p>
    </div>
  );
}
