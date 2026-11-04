import { screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { renderWithIntl } from "@/components/editor/test-helpers";
import { eventView } from "@/lib/events/event-view.fixture";

vi.mock("@/lib/events/time", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/time")>()),
  userTimeZone: () => "Europe/Paris",
}));

import { SupportEventList } from "./SupportEventList";

const mariage = eventView({
  id: "ev-mariage",
  title: "Salon du Mariage ✨",
  starts_at: "2027-03-15T08:00:00Z",
  ends_at: "2027-03-15T16:00:00Z",
  phase: "running",
  lead_count: 3,
});
const portes = eventView({ id: "ev-portes", title: "Portes ouvertes", ends_at: null, phase: "upcoming", lead_count: 0 });

describe("SupportEventList", () => {
  test("ADM-016 lists each event read-only, with its dates, phase and lead count, and links to its leads", () => {
    renderWithIntl(<SupportEventList cardId="card-1" events={[mariage, portes]} />);

    const row = screen.getByTestId("support-event-row-ev-mariage");
    expect(row).toHaveTextContent("Salon du Mariage ✨");
    expect(row).toHaveTextContent("Début : 15 mars 2027 à 09:00");
    expect(row).toHaveTextContent("Fin : 15 mars 2027 à 17:00");
    expect(row).toHaveTextContent("En cours");
    expect(row).toHaveTextContent("3 contacts");
    expect(within(row).getByTestId("support-event-leads-ev-mariage")).toHaveAttribute(
      "href",
      "/support/cards/card-1/events/ev-mariage/leads",
    );

    const open = screen.getByTestId("support-event-row-ev-portes");
    expect(open).toHaveTextContent("Sans fin");
    expect(open).toHaveTextContent("À venir");
    expect(open).toHaveTextContent("Aucun contact");

    expect(screen.getByTestId("support-card-leads")).toHaveAttribute("href", "/support/cards/card-1/leads");
    expect(screen.getByTestId("support-card-leads")).toHaveTextContent("Tous les contacts de la carte");
    // No create, edit, end or delete control: only links.
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getAllByRole("link")).toHaveLength(3);
  });

  test("ADM-016 a card without event still offers the whole-card view", () => {
    renderWithIntl(<SupportEventList cardId="card-1" events={[]} />);
    expect(screen.getByTestId("support-events-empty")).toHaveTextContent("Aucun événement");
    expect(screen.getByTestId("support-card-leads")).toBeVisible();
  });
});
