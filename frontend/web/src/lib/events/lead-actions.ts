import type { createApiClient } from "@cartouche/api-client";
import type { LeadView } from "./types";

/** What a screen can do to a contact; a screen without actions is read-only (ADM-017). */
export type LeadActions = {
  /** Sets the spam mark and returns the contact as the server now has it. */
  setSpam(lead: LeadView, spam: boolean): Promise<LeadView>;
  remove(lead: LeadView): Promise<void>;
};

/** What a successful action did to the list on screen. */
export type LeadChange = { kind: "updated"; lead: LeadView } | { kind: "removed"; id: string };

type OwnerApi = Pick<ReturnType<typeof createApiClient>, "PUT" | "DELETE">;

/** spec: ABU-003, ABU-004. The actions of the owner of the contacts, on the owner API. */
export function ownerLeadActions(api: OwnerApi): LeadActions {
  return {
    async setSpam(lead, spam) {
      const { data } = await api.PUT("/api/leads/{id}/spam", { params: { path: { id: lead.id } }, body: { spam } });
      if (!data) throw new Error("empty response");
      return data;
    },
    async remove(lead) {
      await api.DELETE("/api/leads/{id}", { params: { path: { id: lead.id } } });
    },
  };
}

/** spec: LEA-020. The list after a change: the row replaced by the contact the server returned, or dropped. */
export function applyLeadChange(leads: LeadView[], change: LeadChange): LeadView[] {
  if (change.kind === "removed") return leads.filter((lead) => lead.id !== change.id);
  return leads.map((lead) => (lead.id === change.lead.id ? change.lead : lead));
}
