import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { renderWithIntl } from "@/components/editor/test-helpers";
import { leadView } from "@/lib/events/lead-view.fixture";

vi.mock("@/lib/events/time", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/time")>()),
  userTimeZone: () => "Europe/Paris",
}));

import { SupportLeads } from "./SupportLeads";

const zoe = leadView({
  id: "lead-zoe",
  answers: { first_name: "Zoé", last_name: "Lefèvre ✨", email: "zoe@example.test" },
  phone_display: null,
  event_title: "Mariage",
});
const bot = leadView({
  id: "lead-bot",
  spam: true,
  answers: { first_name: "Bot", last_name: "Spam", email: "bot@example.test" },
  phone_display: null,
  event_title: "Foire",
});

const load = vi.fn();

beforeEach(() => {
  load.mockReset();
  load.mockResolvedValue([zoe, bot]);
});

function show(showEvent = false) {
  return renderWithIntl(
    <SupportLeads backHref="/support/cards/card-1/events" title="Contacts" subtitle="Mariage" load={load} showEvent={showEvent} />,
  );
}

describe("SupportLeads", () => {
  test("ADM-017 ADM-018 support lead pages show the notice and no action or export", async () => {
    show();

    expect(screen.getByTestId("support-leads-notice")).toHaveTextContent(
      "Consultation en lecture seule, enregistrée dans le journal d'audit",
    );
    expect(await screen.findByTestId("lead-row-lead-zoe")).toHaveTextContent("Zoé Lefèvre ✨");
    expect(screen.getByTestId("lead-row-lead-bot")).toBeVisible();
    expect(screen.getByTestId("leads-search")).toBeVisible();
    expect(screen.getByTestId("support-back")).toHaveAttribute("href", "/support/cards/card-1/events");

    expect(screen.queryByTestId("export-open")).toBeNull();
    expect(screen.queryByTestId("lead-spam-lead-zoe")).toBeNull();
    expect(screen.queryByTestId("lead-delete-lead-zoe")).toBeNull();

    fireEvent.click(screen.getByTestId("lead-open-lead-zoe"));
    expect(await screen.findByTestId("lead-detail")).toBeVisible();
    expect(screen.queryByTestId("lead-detail-spam")).toBeNull();
    expect(screen.queryByTestId("lead-detail-delete")).toBeNull();
  });

  test("ADM-019 opening a lead's detail and searching send no request: the list is loaded once", async () => {
    show();
    await screen.findByTestId("lead-row-lead-zoe");
    fireEvent.change(screen.getByTestId("leads-search"), { target: { value: "zoe" } });
    fireEvent.click(screen.getByTestId("lead-open-lead-zoe"));
    expect(await screen.findByTestId("lead-detail-consent")).toBeVisible();
    expect(load).toHaveBeenCalledTimes(1);
  });

  test("LEA-013 ADM-017 the whole-card view shows the event of each lead", async () => {
    show(true);
    expect(await screen.findByTestId("lead-event-lead-zoe")).toHaveTextContent("Mariage");
    expect(screen.getByTestId("lead-event-lead-bot")).toHaveTextContent("Foire");
  });
});
