"use client";

import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { type RefObject, useRef, useState } from "react";
import { ErrorNotice } from "@/components/ErrorNotice";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useDownloadExport } from "@/lib/api";
import { exportCount, type ExportSummary } from "@/lib/events/export-count";
import { exportPath, type ExportFormat, type ExportScope } from "@/lib/events/lead-export";
import { userTimeZone } from "@/lib/events/time";
import { cn } from "@/lib/utils";

const FORMATS = ["csv", "xlsx", "json"] as const satisfies readonly ExportFormat[];
import { returnFocus } from "./return-focus";

/**
 * spec: LEA-006, LEA-012, LEA-021, LEA-035. The export of the leads of `scope`: the owner picks the format and
 * whether the spam leads are included, then downloads the file. The dialog closes once the file is handed to the
 * browser. With a `summary` it names the scope and the button announces the exact number of contacts.
 */
export function ExportDialog({ scope, summary }: { scope: ExportScope; summary?: ExportSummary }) {
  const t = useTranslations("leads.export");
  const [open, setOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <Button ref={openerRef} variant="secondary" data-testid="export-open" onClick={() => setOpen(true)}>
        <Download aria-hidden="true" />
        {t("open")}
      </Button>
      <ExportDialogPanel scope={scope} summary={summary} open={open} onOpenChange={setOpen} returnFocusRef={openerRef} />
    </>
  );
}

/** The export dialog without its button, opened by the caller (the confirmation of an event deletion, EDI-033). */
export function ExportDialogPanel({
  scope,
  summary,
  open,
  onOpenChange,
  returnFocusRef,
}: {
  scope: ExportScope;
  summary?: ExportSummary | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The control that opened the dialog: there is no Radix trigger, so the focus is given back to it by hand. */
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const t = useTranslations("leads.export");
  const tLeads = useTranslations("leads");
  const download = useDownloadExport();
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [includeSpam, setIncludeSpam] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const count = summary === undefined ? null : exportCount(summary.counts, includeSpam);

  function changeOpen(next: boolean) {
    onOpenChange(next);
    setError(null);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await download(exportPath(scope, format, includeSpam, userTimeZone()));
      changeOpen(false);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent
        closeLabel={t("close")}
        className="gap-4 sm:max-w-[520px]"
        onCloseAutoFocus={returnFocus(returnFocusRef)}
      >
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription data-testid="export-scope">
            {summary === undefined
              ? t("scopeUnknown")
              : t.rich("scope", {
                  slug: summary.cardSlug,
                  event: summary.eventTitle ?? tLeads("scope.all"),
                  contacts: tLeads("count", { count: summary.counts.total }),
                  b: (chunks) => <b className="text-app-text">{chunks}</b>,
                })}
          </DialogDescription>
        </DialogHeader>
        <fieldset className="space-y-2">
          <legend className="mb-2 text-base font-[650]">{t("format")}</legend>
          <div className="grid grid-cols-3 gap-2.5">
            {FORMATS.map((value) => (
              <label
                key={value}
                className={cn(
                  "border-app-border-strong flex min-h-11 cursor-pointer flex-col gap-1 rounded-xl border p-3.5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--app-ring)]",
                  format === value && "border-app-text border-2 p-[13px]",
                )}
              >
                <b className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="export-format"
                    className="accent-app-primary size-[18px]"
                    data-testid={`export-format-${value}`}
                    checked={format === value}
                    onChange={() => setFormat(value)}
                  />
                  {t(value)}
                </b>
                <span className="text-app-muted text-[13px] leading-[1.4]">{t(`${value}Hint`)}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex min-h-11 items-start gap-2.5 pt-2.5 text-[15px] leading-[1.4]">
          <input
            type="checkbox"
            className="accent-app-primary size-5 flex-none"
            data-testid="export-include-spam"
            checked={includeSpam}
            onChange={(event) => setIncludeSpam(event.target.checked)}
          />
          {summary === undefined ? t("includeSpamPlain") : t("includeSpam", { count: summary.counts.spam })}
        </label>
        <p className="text-app-muted text-[13px] leading-[1.4]">{t("hint")}</p>
        {error !== null ? <ErrorNotice error={error} /> : null}
        <DialogFooter>
          <Button variant="secondary" data-testid="export-cancel" onClick={() => changeOpen(false)}>
            {t("cancel")}
          </Button>
          <Button data-testid="export-download" disabled={busy} onClick={() => void submit()}>
            <Download aria-hidden="true" />
            {count === null ? t("downloadPlain") : t("download", { count })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
