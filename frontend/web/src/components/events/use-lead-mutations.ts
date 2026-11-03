"use client";

import { useState } from "react";
import type { LeadActions, LeadChange } from "@/lib/events/lead-actions";
import type { LeadView } from "@/lib/events/types";

/**
 * Runs the spam and delete actions of a contact one at a time (`busy` until the answer), keeps the error of the last
 * one, and reports what changed on success. Each resolves to whether it succeeded.
 */
export function useLeadMutations(actions: LeadActions | null, onChange: (change: LeadChange) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function run(task: (actions: LeadActions) => Promise<LeadChange>): Promise<boolean> {
    if (actions === null) return false;
    setBusy(true);
    setError(null);
    let change: LeadChange;
    try {
      change = await task(actions);
    } catch (e) {
      setError(e);
      setBusy(false);
      return false;
    }
    setBusy(false);
    onChange(change);
    return true;
  }

  return {
    busy,
    error,
    toggleSpam: (lead: LeadView) =>
      run(async (a) => ({ kind: "updated", lead: await a.setSpam(lead, !lead.spam) })),
    remove: (lead: LeadView) =>
      run(async (a) => {
        await a.remove(lead);
        return { kind: "removed", id: lead.id };
      }),
  };
}
