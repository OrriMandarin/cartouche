import { ApiError } from "@cartouche/api-client";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { renderWithIntl } from "@/components/editor/test-helpers";
import { leadView } from "@/lib/events/lead-view.fixture";
import type { LeadView } from "@/lib/events/types";

const get = vi.fn();
const put = vi.fn();
const del = vi.fn();
const api = { GET: get, PUT: put, DELETE: del };
vi.mock("@/lib/api", () => ({ useApi: () => api }));
vi.mock("@/lib/events/time", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/time")>()),
  userTimeZone: () => "Europe/Paris",
}));

import { LeadList } from "./LeadList";

const bot = leadView({
  id: "lead-bot",
  submitted_at: "2027-03-15T09:30:00Z",
  spam: true,
  answers: { first_name: "Bot", last_name: "Spam", email: "bot@example.test" },
  phone_display: null,
});
const zoe = leadView({
  id: "lead-zoe",
  submitted_at: "2027-03-15T08:00:00Z",
  answers: { first_name: "Zoé", last_name: "Lefèvre ✨", email: "zoe@example.test" },
  phone_display: null,
});
const eloise = leadView({ id: "lead-eloise", submitted_at: "2027-03-15T07:00:00Z" });

function serve(leads: LeadView[]) {
  get.mockImplementation(() => Promise.resolve({ data: { leads } }));
}

beforeEach(() => {
  get.mockReset();
  put.mockReset();
  del.mockReset();
  put.mockResolvedValue({ data: {} });
  del.mockResolvedValue({});
});

describe("LeadList", () => {
  test("EDI-020 the leads of the event, in the order the API gives (newest first), with date, name, email, phone", async () => {
    serve([bot, zoe, eloise]);
    renderWithIntl(<LeadList eventId="event-1" />);
    await screen.findByTestId("lead-row-lead-bot");
    expect(get).toHaveBeenCalledWith("/api/events/{id}/leads", { params: { path: { id: "event-1" } } });
    expect(screen.getAllByTestId(/^lead-row-/).map((row) => row.dataset.testid)).toEqual([
      "lead-row-lead-bot",
      "lead-row-lead-zoe",
      "lead-row-lead-eloise",
    ]);
    const row = screen.getByTestId("lead-row-lead-eloise");
    // Stored in UTC, shown in the user's zone.
    expect(within(row).getByTestId("lead-date-lead-eloise")).toHaveTextContent("15 mars 2027 à 08:00");
    expect(within(row).getByTestId("lead-name-lead-eloise")).toHaveTextContent("Éloïse D’Aubigné-Müller");
    expect(within(row).getByTestId("lead-email-lead-eloise")).toHaveTextContent("eloise@example.test");
    expect(within(row).getByTestId("lead-phone-lead-eloise")).toHaveTextContent("+33 6 12 34 56 78");
    expect(within(screen.getByTestId("lead-row-lead-zoe")).getByTestId("lead-name-lead-zoe")).toHaveTextContent(
      "Zoé Lefèvre ✨",
    );
  });

  test("ABU-009 only spam contacts carry the « Spam » label, and they stay listed", async () => {
    serve([bot, zoe]);
    renderWithIntl(<LeadList eventId="event-1" />);
    expect(await screen.findByTestId("lead-spam-badge-lead-bot")).toHaveTextContent("Spam");
    expect(screen.queryByTestId("lead-spam-badge-lead-zoe")).toBeNull();
    expect(screen.getByTestId("lead-spam-lead-bot")).toHaveTextContent("Ce n'est pas un spam");
    expect(screen.getByTestId("lead-spam-lead-zoe")).toHaveTextContent("Marquer comme spam");
  });

  test("EDI-020 a lead without a name shows its email, and one without anything says « Contact sans nom »", async () => {
    serve([
      leadView({ id: "mail-only", answers: { email: "anna@example.test" }, phone_display: null }),
      leadView({ id: "nothing", answers: {}, phone_display: "+33 6 12 34 56 78" }),
    ]);
    renderWithIntl(<LeadList eventId="event-1" />);
    expect(await screen.findByTestId("lead-name-mail-only")).toHaveTextContent("anna@example.test");
    expect(screen.getByTestId("lead-name-nothing")).toHaveTextContent("Contact sans nom");
  });

  test("EDI-020 an event without contacts says so", async () => {
    serve([]);
    renderWithIntl(<LeadList eventId="event-1" />);
    expect(await screen.findByTestId("leads-empty")).toHaveTextContent("Aucun contact");
  });

  test("ABU-003 ABU-009 the spam flag can be set and cleared", async () => {
    serve([zoe]);
    renderWithIntl(<LeadList eventId="event-1" />);
    await screen.findByTestId("lead-row-lead-zoe");

    // The server answers with the new mark once the flag is set; the list is reloaded from it.
    serve([{ ...zoe, spam: true }]);
    fireEvent.click(screen.getByTestId("lead-spam-lead-zoe"));
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith("/api/leads/{id}/spam", {
        params: { path: { id: "lead-zoe" } },
        body: { spam: true },
      }),
    );
    expect(await screen.findByTestId("lead-spam-badge-lead-zoe")).toBeVisible();
    await waitFor(() => expect(screen.getByTestId("lead-spam-lead-zoe")).toBeEnabled());

    serve([zoe]);
    fireEvent.click(screen.getByTestId("lead-spam-lead-zoe"));
    await waitFor(() =>
      expect(put).toHaveBeenLastCalledWith("/api/leads/{id}/spam", {
        params: { path: { id: "lead-zoe" } },
        body: { spam: false },
      }),
    );
    await waitFor(() => expect(screen.queryByTestId("lead-spam-badge-lead-zoe")).toBeNull());
  });

  test("ABU-004 ABU-010 deleting asks for confirmation", async () => {
    serve([bot, zoe]);
    renderWithIntl(<LeadList eventId="event-1" />);
    fireEvent.click(await screen.findByTestId("lead-delete-lead-bot"));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Ce contact sera supprimé définitivement.");
    expect(del).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByTestId("lead-delete-cancel"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(del).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("lead-delete-lead-bot"));
    fireEvent.click(await screen.findByTestId("lead-delete-confirm"));
    await waitFor(() => expect(del).toHaveBeenCalledWith("/api/leads/{id}", { params: { path: { id: "lead-bot" } } }));
    expect(del).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });

  test("ABU-003 ABU-004 the buttons stay disabled until the list reloads", async () => {
    serve([bot, zoe]);
    renderWithIntl(<LeadList eventId="event-1" />);
    await screen.findByTestId("lead-row-lead-zoe");
    // The reload that follows the action stays pending.
    let finishReload: () => void = () => undefined;
    get.mockImplementation(() => new Promise((resolve) => (finishReload = () => resolve({ data: { leads: [bot, zoe] } }))));
    fireEvent.click(screen.getByTestId("lead-spam-lead-zoe"));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("lead-spam-lead-zoe")).toBeDisabled();
    expect(screen.getByTestId("lead-delete-lead-bot")).toBeDisabled();
    finishReload();
    await waitFor(() => expect(screen.getByTestId("lead-spam-lead-zoe")).toBeEnabled());
  });

  test("ABU-003 a failed action shows the generic notice with the request id, and the buttons come back", async () => {
    serve([zoe]);
    put.mockRejectedValue(new ApiError({ status: 500, code: "internal_error", message: "Boom.", requestId: "req-500" }));
    renderWithIntl(<LeadList eventId="event-1" />);
    fireEvent.click(await screen.findByTestId("lead-spam-lead-zoe"));
    expect(await screen.findByTestId("error-request-id")).toHaveTextContent("req-500");
    expect(screen.getByTestId("lead-spam-lead-zoe")).toBeEnabled();
  });

  test("EDI-020 a failure to load shows the generic notice", async () => {
    get.mockRejectedValue(new ApiError({ status: 500, code: "internal_error", message: "Boom.", requestId: "req-load" }));
    renderWithIntl(<LeadList eventId="event-1" />);
    expect(await screen.findByTestId("error-request-id")).toHaveTextContent("req-load");
  });
});
