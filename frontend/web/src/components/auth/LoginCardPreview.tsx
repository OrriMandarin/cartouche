"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { buildCardUrls } from "@/lib/card-urls";
import { loginPreviewCard, loginPreviewEvents } from "@/lib/login-preview";
import { buildTemplateLabels } from "@/templates/contract";
import { renderTemplate } from "@/templates/registry";

/** A sample card in a phone frame, rendered by the real template: it shows what Cartouche makes. Decorative. */
export function LoginCardPreview({ className }: { className?: string }) {
  const t = useTranslations();
  const labels = useMemo(() => buildTemplateLabels(t), [t]);
  const events = useMemo(() => loginPreviewEvents(t("auth.login.previewEvent")), [t]);

  return (
    <div
      aria-hidden="true"
      // `inert`: the card holds links and buttons that must not take the focus.
      inert
      data-testid="login-card-preview"
      className={`shadow-app-lg overflow-hidden rounded-[36px] border-8 border-app-text bg-app-surface ${className ?? ""}`}
    >
      {renderTemplate({
        template: loginPreviewCard.template,
        settings: loginPreviewCard.settings,
        theme: loginPreviewCard.theme,
        card: loginPreviewCard,
        events,
        urls: buildCardUrls(loginPreviewCard),
        labels,
        mode: "preview",
      })}
    </div>
  );
}
