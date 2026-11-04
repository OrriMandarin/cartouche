"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { showToast } from "@/lib/toast";
import type { LeadActions, LeadChange } from "@/lib/events/lead-actions";
import type { LeadView } from "@/lib/events/types";

/**
 * spec: LEA-034. Runs the spam and delete actions of a contact one at a time (`busy` until the answer), keeps the
 * error of the last one, and reports what changed on success. Each resolves to whether it succeeded. A spam change
 * is announced by a toast whose « Annuler » sets the opposite mark (without announcing it again).
 */
export function useLeadMutations(actions: LeadActions | null, onChange: (change: LeadChange) => void) {
  const t = useTranslations("leads");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function run(task: (actions: LeadActions) => Promise<LeadChange>): Promise<LeadChange | null> {
    if (actions === null) return null;
    setBusy(true);
    setError(null);
    let change: LeadChange;
    try {
      change = await task(actions);
    } catch (e) {
      setError(e);
      setBusy(false);
      return null;
    }
    setBusy(false);
    onChange(change);
    return change;
  }

  const setSpam = (lead: LeadView, spam: boolean) =>
    run(async (a) => ({ kind: "updated", lead: await a.setSpam(lead, spam) }));

  // The sheet is usually closed by then, so the failure of the undo is announced by a toast.
  async function undoSpam(updated: LeadView) {
    if ((await setSpam(updated, !updated.spam)) === null) showToast(t("undoFailed"));
  }

  return {
    busy,
    error,
    toggleSpam: async (lead: LeadView): Promise<boolean> => {
      const change = await setSpam(lead, !lead.spam);
      if (change?.kind !== "updated") return false;
      const updated = change.lead;
      showToast(updated.spam ? t("markedSpam") : t("unmarkedSpam"), {
        action: { label: t("undo"), onClick: () => void undoSpam(updated) },
      });
      return true;
    },
    remove: async (lead: LeadView): Promise<boolean> =>
      (await run(async (a) => {
        await a.remove(lead);
        return { kind: "removed", id: lead.id };
      })) !== null,
  };
}
