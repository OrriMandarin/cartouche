import { ApiError } from "@cartouche/api-client";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { renderWithIntl } from "@/components/editor/test-helpers";
import type { LeadActions } from "@/lib/events/lead-actions";
import { leadView } from "@/lib/events/lead-view.fixture";
import type { LeadView } from "@/lib/events/types";

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

const load = vi.fn();
const setSpam = vi.fn();
const remove = vi.fn();
const actions: LeadActions = { setSpam, remove };

function serve(leads: LeadView[]) {
  load.mockImplementation(() => Promise.resolve(leads));
}

function show(props: { actions?: LeadActions | null; showEvent?: boolean; toolbar?: React.ReactNode } = {}) {
  return renderWithIntl(
    <LeadList load={load} actions={props.actions === undefined ? actions : props.actions} showEvent={props.showEvent ?? false} toolbar={props.toolbar} />,
  );
}

beforeEach(() => {
  load.mockReset();
  setSpam.mockReset();
  remove.mockReset();
  setSpam.mockImplementation((lead: LeadView, spam: boolean) => Promise.resolve({ ...lead, spam }));
  remove.mockResolvedValue(undefined);
});

describe("LeadList", () => {
  test("EDI-020 LEA-014 the leads, in the order given (newest first), with date, name, email, phone", async () => {
    serve([bot, zoe, eloise]);
    show();
    await screen.findByTestId("lead-row-lead-bot");
    expect(load).toHaveBeenCalledTimes(1);
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
    expect(screen.getByTestId("leads-count")).toHaveTextContent("3 contacts");
  });

  test("ABU-009 LEA-014 only spam contacts carry the « Spam » label, and they stay listed", async () => {
    serve([bot, zoe]);
    show();
    expect(await screen.findByTestId("lead-spam-badge-lead-bot")).toHaveTextContent("Spam");
    expect(screen.queryByTestId("lead-spam-badge-lead-zoe")).toBeNull();
    expect(screen.getByTestId("lead-spam-lead-bot")).toHaveTextContent("Ce n'est pas un spam");
    expect(screen.getByTestId("lead-spam-lead-zoe")).toHaveTextContent("Marquer comme spam");
  });

  test("LEA-017 a nameless lead shows its email once, and one without anything says « Contact sans nom »", async () => {
    serve([
      leadView({ id: "mail-only", answers: { email: "anna@example.test" }, phone_display: null }),
      leadView({ id: "nothing", answers: {}, phone_display: "+33 6 12 34 56 78" }),
    ]);
    show();
    expect(await screen.findByTestId("lead-name-mail-only")).toHaveTextContent("anna@example.test");
    expect(screen.queryByTestId("lead-email-mail-only")).toBeNull();
    expect(within(screen.getByTestId("lead-row-mail-only")).getAllByText("anna@example.test")).toHaveLength(1);
    expect(screen.getByTestId("lead-name-nothing")).toHaveTextContent("Contact sans nom");
  });

  test("EDI-020 an event without contacts says so, and offers no search", async () => {
    serve([]);
    show();
    expect(await screen.findByTestId("leads-empty")).toHaveTextContent("Aucun contact");
    expect(screen.queryByTestId("leads-search")).toBeNull();
  });

  test("LEA-015 typing in the search filters the rows and says when nothing matches", async () => {
    serve([bot, zoe, eloise]);
    show();
    await screen.findByTestId("lead-row-lead-bot");
    expect(screen.getByLabelText("Rechercher un contact")).toBe(screen.getByTestId("leads-search"));

    fireEvent.change(screen.getByTestId("leads-search"), { target: { value: "eloise aubigne" } });
    expect(screen.getAllByTestId(/^lead-row-/).map((row) => row.dataset.testid)).toEqual(["lead-row-lead-eloise"]);
    expect(screen.getByTestId("leads-count")).toHaveTextContent("1 contact");

    fireEvent.change(screen.getByTestId("leads-search"), { target: { value: "zzz" } });
    expect(screen.queryAllByTestId(/^lead-row-/)).toHaveLength(0);
    expect(screen.getByTestId("leads-no-match")).toHaveTextContent("Aucun contact ne correspond à ta recherche.");
    expect(screen.queryByTestId("leads-empty")).toBeNull();

    fireEvent.change(screen.getByTestId("leads-search"), { target: { value: "" } });
    expect(screen.getAllByTestId(/^lead-row-/)).toHaveLength(3);
    expect(screen.queryByTestId("leads-no-match")).toBeNull();
  });

  test("LEA-016 a phone-like search finds the contact by its digits", async () => {
    serve([zoe, eloise]);
    show();
    await screen.findByTestId("lead-row-lead-zoe");
    fireEvent.change(screen.getByTestId("leads-search"), { target: { value: "0612" } });
    expect(screen.getAllByTestId(/^lead-row-/).map((row) => row.dataset.testid)).toEqual(["lead-row-lead-eloise"]);
  });

  test("LEA-014 LEA-021 the toolbar is shown above the list, and the event title only when asked", async () => {
    serve([zoe]);
    const { unmount } = show({ toolbar: <p data-testid="toolbar-stub">export</p>, showEvent: true });
    expect(await screen.findByTestId("toolbar-stub")).toBeVisible();
    expect(screen.getByTestId("lead-event-lead-zoe")).toHaveTextContent("Salon du Mariage");
    unmount();

    show();
    await screen.findByTestId("lead-row-lead-zoe");
    expect(screen.queryByTestId("lead-event-lead-zoe")).toBeNull();
  });

  test("ABU-003 ABU-009 LEA-020 a spam toggle updates the row from the response without reloading", async () => {
    serve([zoe]);
    show();
    await screen.findByTestId("lead-row-lead-zoe");

    fireEvent.click(screen.getByTestId("lead-spam-lead-zoe"));
    await waitFor(() => expect(setSpam).toHaveBeenCalledWith(zoe, true));
    expect(await screen.findByTestId("lead-spam-badge-lead-zoe")).toBeVisible();
    await waitFor(() => expect(screen.getByTestId("lead-spam-lead-zoe")).toBeEnabled());
    expect(screen.getByTestId("lead-spam-lead-zoe")).toHaveTextContent("Ce n'est pas un spam");

    fireEvent.click(screen.getByTestId("lead-spam-lead-zoe"));
    await waitFor(() => expect(setSpam).toHaveBeenLastCalledWith({ ...zoe, spam: true }, false));
    await waitFor(() => expect(screen.queryByTestId("lead-spam-badge-lead-zoe")).toBeNull());
    expect(load).toHaveBeenCalledTimes(1);
  });

  test("ABU-004 ABU-010 deleting asks for confirmation", async () => {
    serve([bot, zoe]);
    show();
    fireEvent.click(await screen.findByTestId("lead-delete-lead-bot"));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Ce contact sera supprimé définitivement.");
    expect(remove).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByTestId("lead-delete-cancel"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(remove).not.toHaveBeenCalled();
    expect(screen.getByTestId("lead-row-lead-bot")).toBeVisible();

    fireEvent.click(screen.getByTestId("lead-delete-lead-bot"));
    fireEvent.click(await screen.findByTestId("lead-delete-confirm"));
    await waitFor(() => expect(remove).toHaveBeenCalledWith(bot));
    expect(remove).toHaveBeenCalledTimes(1);
  });

  test("LEA-020 a deleted row disappears even if nothing is reloaded", async () => {
    serve([bot, zoe]);
    show();
    fireEvent.click(await screen.findByTestId("lead-delete-lead-bot"));
    fireEvent.click(await screen.findByTestId("lead-delete-confirm"));
    await waitFor(() => expect(screen.queryByTestId("lead-row-lead-bot")).toBeNull());
    expect(screen.getByTestId("lead-row-lead-zoe")).toBeVisible();
    expect(screen.getByTestId("leads-count")).toHaveTextContent("1 contact");
    expect(load).toHaveBeenCalledTimes(1);
  });

  test("ABU-003 ABU-004 the buttons stay disabled while an action is pending", async () => {
    serve([bot, zoe]);
    show();
    await screen.findByTestId("lead-row-lead-zoe");
    let finish: () => void = () => undefined;
    setSpam.mockImplementation((lead: LeadView) => new Promise((resolve) => (finish = () => resolve({ ...lead, spam: true }))));
    fireEvent.click(screen.getByTestId("lead-spam-lead-zoe"));
    await waitFor(() => expect(screen.getByTestId("lead-spam-lead-zoe")).toBeDisabled());
    expect(screen.getByTestId("lead-delete-lead-bot")).toBeDisabled();
    finish();
    await waitFor(() => expect(screen.getByTestId("lead-spam-lead-zoe")).toBeEnabled());
  });

  test("ABU-003 LEA-020 a failed action shows the generic notice with the request id and leaves the list as it was", async () => {
    serve([zoe]);
    setSpam.mockRejectedValue(new ApiError({ status: 500, code: "internal_error", message: "Boom.", requestId: "req-500" }));
    show();
    fireEvent.click(await screen.findByTestId("lead-spam-lead-zoe"));
    expect(await screen.findByTestId("error-request-id")).toHaveTextContent("req-500");
    expect(screen.getByTestId("lead-spam-lead-zoe")).toBeEnabled();
    expect(screen.queryByTestId("lead-spam-badge-lead-zoe")).toBeNull();
  });

  test("ADM-017 without actions there is no spam or delete button", async () => {
    serve([bot, zoe]);
    show({ actions: null });
    await screen.findByTestId("lead-row-lead-zoe");
    expect(screen.queryByTestId("lead-spam-lead-zoe")).toBeNull();
    expect(screen.queryByTestId("lead-delete-lead-zoe")).toBeNull();
    expect(screen.getByTestId("lead-open-lead-zoe")).toBeVisible();
    // The spam label itself is still shown.
    expect(screen.getByTestId("lead-spam-badge-lead-bot")).toBeVisible();
  });

  test("LEA-003 « Voir » opens the detail of that contact, which closes again", async () => {
    serve([bot, zoe]);
    show();
    fireEvent.click(await screen.findByTestId("lead-open-lead-zoe"));
    const detail = await screen.findByTestId("lead-detail");
    expect(detail).toHaveTextContent("Zoé Lefèvre ✨");
    fireEvent.click(within(detail).getByRole("button", { name: "Fermer" }));
    await waitFor(() => expect(screen.queryByTestId("lead-detail")).toBeNull());
  });

  test("LEA-004 LEA-020 a spam toggle from the detail updates the row and the detail", async () => {
    serve([zoe]);
    show();
    fireEvent.click(await screen.findByTestId("lead-open-lead-zoe"));
    fireEvent.click(await screen.findByTestId("lead-detail-spam"));
    await waitFor(() => expect(setSpam).toHaveBeenCalledWith(zoe, true));
    expect(await screen.findByTestId("lead-spam-badge-lead-zoe")).toBeVisible();
    expect(screen.getByTestId("lead-detail-spam-state")).toHaveTextContent("Marqué comme spam");
    expect(load).toHaveBeenCalledTimes(1);
  });

  test("LEA-004 LEA-020 deleting from the detail asks, then removes the row and closes the detail", async () => {
    serve([bot, zoe]);
    show();
    fireEvent.click(await screen.findByTestId("lead-open-lead-bot"));
    fireEvent.click(await screen.findByTestId("lead-detail-delete"));
    expect(await screen.findByTestId("lead-delete-confirm")).toBeVisible();
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("lead-delete-confirm"));
    await waitFor(() => expect(remove).toHaveBeenCalledWith(bot));
    await waitFor(() => expect(screen.queryByTestId("lead-detail")).toBeNull());
    expect(screen.queryByTestId("lead-row-lead-bot")).toBeNull();
    expect(screen.getByTestId("lead-row-lead-zoe")).toBeVisible();
  });

  test("EDI-020 a failure to load shows the generic notice", async () => {
    load.mockRejectedValue(new ApiError({ status: 500, code: "internal_error", message: "Boom.", requestId: "req-load" }));
    show();
    expect(await screen.findByTestId("error-request-id")).toHaveTextContent("req-load");
    expect(screen.queryByTestId("leads-loading")).toBeNull();
  });
});
