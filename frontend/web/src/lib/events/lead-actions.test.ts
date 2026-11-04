import { describe, expect, test, vi } from "vitest";
import { applyLeadChange, ownerLeadActions, type LeadChange } from "./lead-actions";
import { leadView } from "./lead-view.fixture";

const zoe = leadView({ id: "lead-zoe", answers: { first_name: "Zoé" } });
const bot = leadView({ id: "lead-bot", answers: { first_name: "Bot" } });

function fakeApi() {
  return { PUT: vi.fn(), DELETE: vi.fn() };
}

describe("ownerLeadActions", () => {
  test("ABU-003 LEA-020 setSpam sets the opposite mark and returns the contact the server answers", async () => {
    const api = fakeApi();
    api.PUT.mockResolvedValue({ data: { ...zoe, spam: true } });
    const returned = await ownerLeadActions(api as never).setSpam(zoe, true);
    expect(api.PUT).toHaveBeenCalledWith("/api/leads/{id}/spam", {
      params: { path: { id: "lead-zoe" } },
      body: { spam: true },
    });
    expect(returned).toEqual({ ...zoe, spam: true });
  });

  test("ABU-003 a spam answer without a contact is an error, not a silent no-op", async () => {
    const api = fakeApi();
    api.PUT.mockResolvedValue({});
    await expect(ownerLeadActions(api as never).setSpam(zoe, true)).rejects.toThrow("empty response");
  });

  test("ABU-004 remove deletes the contact", async () => {
    const api = fakeApi();
    api.DELETE.mockResolvedValue({});
    await ownerLeadActions(api as never).remove(bot);
    expect(api.DELETE).toHaveBeenCalledWith("/api/leads/{id}", { params: { path: { id: "lead-bot" } } });
  });

  test("ABU-004 a failed deletion rejects", async () => {
    const api = fakeApi();
    api.DELETE.mockRejectedValue(new Error("boom"));
    await expect(ownerLeadActions(api as never).remove(bot)).rejects.toThrow("boom");
  });
});

describe("applyLeadChange", () => {
  test("LEA-020 an updated contact replaces its row and keeps the order", () => {
    const change: LeadChange = { kind: "updated", lead: { ...zoe, spam: true } };
    expect(applyLeadChange([bot, zoe], change)).toEqual([bot, { ...zoe, spam: true }]);
  });

  test("LEA-020 a removed contact leaves the list", () => {
    expect(applyLeadChange([bot, zoe], { kind: "removed", id: "lead-bot" })).toEqual([zoe]);
  });

  test("LEA-020 the list is not mutated", () => {
    const leads = [bot, zoe];
    applyLeadChange(leads, { kind: "removed", id: "lead-bot" });
    expect(leads).toEqual([bot, zoe]);
  });
});
