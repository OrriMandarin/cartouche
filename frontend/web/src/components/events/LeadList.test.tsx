import { ApiError } from "@cartouche/api-client";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { renderWithIntl } from "@/components/editor/test-helpers";
import type { LeadActions } from "@/lib/events/lead-actions";
import { leadView } from "@/lib/events/lead-view.fixture";
import type { LeadView } from "@/lib/events/types";

vi.mock("@/lib/events/time", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/time")>()),
  userTimeZone: () => "Europe/Paris",
}));

const showToast = vi.fn();
vi.mock("@/lib/toast", () => ({ showToast: (...args: unknown[]) => showToast(...args) }));

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
  showToast.mockReset();
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
    expect(within(row).getByTestId("lead-date-lead-eloise")).toHaveTextContent("15 mars 2027 · 08:00");
    expect(within(row).getByTestId("lead-name-lead-eloise")).toHaveTextContent("Éloïse D’Aubigné-Müller");
    expect(within(row).getByTestId("lead-email-lead-eloise")).toHaveTextContent("eloise@example.test");
    expect(within(row).getByTestId("lead-phone-lead-eloise")).toHaveTextContent("+33 6 12 34 56 78");
    expect(within(screen.getByTestId("lead-row-lead-zoe")).getByTestId("lead-name-lead-zoe")).toHaveTextContent(
      "Zoé Lefèvre ✨",
    );
    expect(screen.getByTestId("leads-count")).toHaveTextContent("3 contacts, dont 1 marqué comme spam");
  });

  test("ABU-009 LEA-014 only spam contacts carry the « Spam » label, and they stay listed", async () => {
    serve([bot, zoe]);
    show();
    expect(await screen.findByTestId("lead-spam-badge-lead-bot")).toHaveTextContent("Spam");
    expect(screen.queryByTestId("lead-spam-badge-lead-zoe")).toBeNull();
    expect(screen.getByTestId("lead-row-lead-bot")).toBeVisible();
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

  test("ABU-003 ABU-009 LEA-020 a spam toggle in the sheet updates the row from the response without reloading", async () => {
    serve([zoe]);
    show();
    fireEvent.click(await screen.findByTestId("lead-open-lead-zoe"));

    fireEvent.click(await screen.findByTestId("lead-detail-spam"));
    await waitFor(() => expect(setSpam).toHaveBeenCalledWith(zoe, true));
    expect(await screen.findByTestId("lead-spam-badge-lead-zoe")).toBeVisible();
    await waitFor(() => expect(screen.queryByTestId("lead-detail")).toBeNull());
    expect(screen.getByTestId("leads-count")).toHaveTextContent("1 contact, dont 1 marqué comme spam");

    fireEvent.click(screen.getByTestId("lead-open-lead-zoe"));
    expect(await screen.findByTestId("lead-detail-spam-state")).toHaveTextContent("Spam");
    expect(screen.getByTestId("lead-detail-spam")).toHaveTextContent("Retirer le marquage spam");
    fireEvent.click(screen.getByTestId("lead-detail-spam"));
    await waitFor(() => expect(setSpam).toHaveBeenLastCalledWith({ ...zoe, spam: true }, false));
    await waitFor(() => expect(screen.queryByTestId("lead-spam-badge-lead-zoe")).toBeNull());
    expect(load).toHaveBeenCalledTimes(1);
  });

  test("LEA-034 the spam toast undoes the change", async () => {
    serve([zoe]);
    show();
    fireEvent.click(await screen.findByTestId("lead-open-lead-zoe"));
    fireEvent.click(await screen.findByTestId("lead-detail-spam"));
    await screen.findByTestId("lead-spam-badge-lead-zoe");
    await waitFor(() => expect(screen.queryByTestId("lead-detail")).toBeNull());
    expect(showToast).toHaveBeenCalledTimes(1);
    const [message, { action }] = showToast.mock.calls[0] as [string, { action: { label: string; onClick: () => void } }];
    expect(message).toBe("Contact marqué comme spam");
    expect(action.label).toBe("Annuler");

    action.onClick();
    await waitFor(() => expect(setSpam).toHaveBeenLastCalledWith({ ...zoe, spam: true }, false));
    await waitFor(() => expect(screen.queryByTestId("lead-spam-badge-lead-zoe")).toBeNull());
    // Undoing is not announced again.
    expect(showToast).toHaveBeenCalledTimes(1);
  });

  test("LEA-034 removing the spam mark is announced too, and its undo marks the contact again", async () => {
    serve([bot]);
    show();
    fireEvent.click(await screen.findByTestId("lead-open-lead-bot"));
    fireEvent.click(await screen.findByTestId("lead-detail-spam"));
    await waitFor(() => expect(screen.queryByTestId("lead-spam-badge-lead-bot")).toBeNull());
    const [message, { action }] = showToast.mock.calls[0] as [string, { action: { onClick: () => void } }];
    expect(message).toBe("Marquage spam retiré");

    action.onClick();
    expect(await screen.findByTestId("lead-spam-badge-lead-bot")).toBeVisible();
  });

  test("ABU-004 ABU-010 deleting asks for confirmation", async () => {
    serve([bot, zoe]);
    show();
    fireEvent.click(await screen.findByTestId("lead-open-lead-bot"));
    fireEvent.click(await screen.findByTestId("lead-detail-delete"));
    expect(await screen.findByText("Ce contact sera supprimé définitivement.")).toBeVisible();
    expect(remove).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("lead-delete-cancel"));
    await waitFor(() => expect(screen.queryByTestId("lead-delete-confirm")).toBeNull());
    expect(remove).not.toHaveBeenCalled();
    expect(screen.getByTestId("lead-row-lead-bot")).toBeVisible();

    fireEvent.click(screen.getByTestId("lead-detail-delete"));
    fireEvent.click(await screen.findByTestId("lead-delete-confirm"));
    await waitFor(() => expect(remove).toHaveBeenCalledWith(bot));
    expect(remove).toHaveBeenCalledTimes(1);
  });

  test("ADM-017 without actions the sheet has no spam or delete button", async () => {
    serve([bot, zoe]);
    show({ actions: null });
    fireEvent.click(await screen.findByTestId("lead-open-lead-zoe"));
    expect(await screen.findByTestId("lead-detail")).toBeVisible();
    expect(screen.queryByTestId("lead-detail-spam")).toBeNull();
    expect(screen.queryByTestId("lead-detail-delete")).toBeNull();
    // The spam label itself is still shown.
    expect(screen.getByTestId("lead-spam-badge-lead-bot")).toBeVisible();
  });

  test("LEA-003 a contact's name opens the detail of that contact, which closes again", async () => {
    serve([bot, zoe]);
    show();
    fireEvent.click(await screen.findByTestId("lead-open-lead-zoe"));
    const detail = await screen.findByTestId("lead-detail");
    expect(detail).toHaveTextContent("Zoé Lefèvre ✨");
    fireEvent.click(within(detail).getByRole("button", { name: "Fermer" }));
    await waitFor(() => expect(screen.queryByTestId("lead-detail")).toBeNull());
  });

  test("ABU-003 ABU-004 the sheet buttons stay disabled while an action is pending", async () => {
    serve([zoe]);
    show();
    fireEvent.click(await screen.findByTestId("lead-open-lead-zoe"));
    let finish: () => void = () => undefined;
    setSpam.mockImplementation((lead: LeadView) => new Promise((resolve) => (finish = () => resolve({ ...lead, spam: true }))));
    fireEvent.click(await screen.findByTestId("lead-detail-spam"));
    await waitFor(() => expect(screen.getByTestId("lead-detail-spam")).toBeDisabled());
    expect(screen.getByTestId("lead-detail-delete")).toBeDisabled();
    finish();
    await waitFor(() => expect(screen.queryByTestId("lead-detail")).toBeNull());
  });

  test("ABU-003 LEA-020 a failed action shows the generic notice with the request id and leaves the list as it was", async () => {
    serve([zoe]);
    setSpam.mockRejectedValue(new ApiError({ status: 500, code: "internal_error", message: "Boom.", requestId: "req-500" }));
    show();
    fireEvent.click(await screen.findByTestId("lead-open-lead-zoe"));
    fireEvent.click(await screen.findByTestId("lead-detail-spam"));
    expect(await screen.findByTestId("error-request-id")).toHaveTextContent("req-500");
    expect(screen.getByTestId("lead-detail-spam")).toBeEnabled();
    expect(screen.queryByTestId("lead-spam-badge-lead-zoe")).toBeNull();
    expect(showToast).not.toHaveBeenCalled();
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
    expect(screen.getByTestId("leads-count")).toHaveTextContent("1 contact");
    expect(load).toHaveBeenCalledTimes(1);
  });

  test("EDI-031 only the contacts of the event asked for are listed, and counted", async () => {
    serve([
      leadView({ id: "a", event_id: "ev-1", answers: { first_name: "Anna" } }),
      leadView({ id: "b", event_id: "ev-2", answers: { first_name: "Bruno" } }),
    ]);
    renderWithIntl(<LeadList load={load} actions={actions} showEvent={false} eventId="ev-2" />);
    await screen.findByTestId("lead-row-b");
    expect(screen.queryByTestId("lead-row-a")).toBeNull();
    expect(screen.getByTestId("leads-count")).toHaveTextContent("1 contact");
  });

  test("EDI-031 the slots go where the page puts them: above, before the search, and between the search and the table", async () => {
    serve([zoe]);
    renderWithIntl(
      <LeadList
        load={load}
        actions={actions}
        showEvent={false}
        toolbar={(leads) => <p data-testid="slot-toolbar">{leads === null ? "loading" : `${leads.length} loaded`}</p>}
        controls={<p data-testid="slot-controls" />}
        scopeBar={(leads) => <p data-testid="slot-scope">{leads.length}</p>}
      />,
    );
    expect(screen.getByTestId("slot-toolbar")).toHaveTextContent("loading");
    await screen.findByTestId("lead-row-lead-zoe");
    expect(screen.getByTestId("slot-toolbar")).toHaveTextContent("1 loaded");
    expect(screen.getByTestId("slot-controls")).toBeVisible();
    expect(screen.getByTestId("slot-scope")).toHaveTextContent("1");
  });

  test("LEA-014 an inline load function is called once, however often the parent re-renders", async () => {
    serve([zoe]);
    function Parent() {
      const [renders, setRenders] = useState(0);
      return (
        <>
          <button data-testid="rerender" onClick={() => setRenders(renders + 1)} />
          <LeadList load={() => load()} actions={actions} showEvent={renders > 0} />
        </>
      );
    }
    renderWithIntl(<Parent />);
    await screen.findByTestId("lead-row-lead-zoe");
    fireEvent.click(screen.getByTestId("rerender"));
    await screen.findByTestId("lead-event-lead-zoe");
    fireEvent.click(screen.getByTestId("rerender"));
    await waitFor(() => expect(screen.getByTestId("lead-row-lead-zoe")).toBeVisible());
    expect(load).toHaveBeenCalledTimes(1);
  });

  test("EDI-020 a failure to load shows the generic notice", async () => {
    load.mockRejectedValue(new ApiError({ status: 500, code: "internal_error", message: "Boom.", requestId: "req-load" }));
    show();
    expect(await screen.findByTestId("error-request-id")).toHaveTextContent("req-load");
    expect(screen.queryByTestId("leads-loading")).toBeNull();
  });
});
