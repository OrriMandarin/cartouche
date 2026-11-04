"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
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
import { exportPath, type ExportFormat, type ExportScope } from "@/lib/events/lead-export";
import { userTimeZone } from "@/lib/events/time";

const FORMATS = ["csv", "xlsx", "json"] as const satisfies readonly ExportFormat[];

/**
 * spec: LEA-006, LEA-012, LEA-021. The export of the leads of `scope`: the owner picks the format and whether the
 * spam leads are included, then downloads the file. The dialog closes once the file is handed to the browser.
 */
export function ExportDialog({ scope }: { scope: ExportScope }) {
  const t = useTranslations("leads.export");
  const download = useDownloadExport();
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [includeSpam, setIncludeSpam] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  function changeOpen(next: boolean) {
    setOpen(next);
    setError(null);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await download(exportPath(scope, format, includeSpam, userTimeZone()));
      setOpen(false);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="outline" data-testid="export-open" onClick={() => changeOpen(true)}>
        {t("open")}
      </Button>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent closeLabel={t("close")}>
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">{t("format")}</legend>
            {FORMATS.map((value) => (
              <label key={value} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="export-format"
                  data-testid={`export-format-${value}`}
                  checked={format === value}
                  onChange={() => setFormat(value)}
                />
                {t(value)}
              </label>
            ))}
            <p className="text-muted-foreground text-sm">{t("excelHint")}</p>
          </fieldset>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              data-testid="export-include-spam"
              checked={includeSpam}
              onChange={(event) => setIncludeSpam(event.target.checked)}
            />
            {t("includeSpam")}
          </label>
          {error !== null ? <ErrorNotice error={error} /> : null}
          <DialogFooter>
            <Button variant="outline" data-testid="export-cancel" onClick={() => changeOpen(false)}>
              {t("cancel")}
            </Button>
            <Button data-testid="export-download" disabled={busy} onClick={() => void submit()}>
              {t("download")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
