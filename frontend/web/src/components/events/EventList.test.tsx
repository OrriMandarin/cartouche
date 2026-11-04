import { ApiError } from "@cartouche/api-client";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { renderWithIntl } from "@/components/editor/test-helpers";
import { eventView } from "@/lib/events/event-view.fixture";

const post = vi.fn();
const del = vi.fn();
const api = { POST: post, DELETE: del };
vi.mock("@/lib/api", () => ({ useApi: () => api, useDownloadExport: () => vi.fn() }));
vi.mock("@/lib/events/time", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/time")>()),
  userTimeZone: () => "Europe/Paris",
}));

import { EventList } from "./EventList";

const running = eventView({
  id: "running-1",
  title: "Salon du Mariage ✨",
  starts_at: "2027-03-15T08:00:00Z",
  ends_at: "2027-03-15T16:00:00Z",
  phase: "running",
  lead_count: 3,
});
const open = eventView({ id: "running-2", title: "Portes ouvertes", starts_at: "2027-03-15T09:00:00Z", ends_at: null, phase: "running", lead_count: 0 });
const upcoming = eventView({ id: "upcoming-1", title: "Foire de Lyon", phase: "upcoming", lead_count: 1 });
const past = eventView({ id: "past-1", title: "Salon de Paris 2026", starts_at: "2027-02-03T10:00:00Z", ends_at: "2027-02-05T10:00:00Z", phase: "past", lead_count: 2 });

function renderList(events = [running, open, upcoming, past], onChanged = vi.fn(() => Promise.resolve()), max = 3) {
  renderWithIntl(<EventList events={events} max={max} newEventHref="/dashboard/cards/c1/events/new" onChanged={onChanged} />);
  return onChanged;
}

beforeEach(() => {
  post.mockReset();
  del.mockReset();
  post.mockResolvedValue({ data: {} });
  del.mockResolvedValue({});
});

describe("EventList", () => {
  test("EDI-018 event row shows title, dates, phase and lead count", () => {
    renderList();
    const row = screen.getByTestId("event-row-running-1");
    expect(within(row).getByTestId("event-title-running-1")).toHaveTextContent("Salon du Mariage ✨");
    // Stored in UTC, shown in the user's zone (EVT-007).
    expect(within(row).getByTestId("event-start-running-1")).toHaveTextContent("15 mars 2027 à 09:00");
    expect(within(row).getByTestId("event-end-running-1")).toHaveTextContent("15 mars 2027 à 17:00");
    expect(within(row).getByTestId("event-phase-running-1")).toHaveTextContent("En cours");
    expect(within(row).getByTestId("event-lead-count-running-1")).toHaveTextContent("3 contacts");
    expect(within(row).getByTestId("event-edit-running-1")).toHaveAttribute(
      "href",
      "/dashboard/cards/0198c8a0-0000-7000-8000-000000000001/events/running-1",
    );
    expect(within(row).getByTestId("event-contacts-running-1")).toHaveAttribute(
      "href",
      "/dashboard/cards/0198c8a0-0000-7000-8000-000000000001/events/running-1/leads",
    );
  });

  test("EDI-018 an event without an end says « Sans fin », and the lead count agrees in number", () => {
    renderList();
    expect(screen.getByTestId("event-end-running-2")).toHaveTextContent("Sans fin");
    expect(screen.getByTestId("event-lead-count-running-2")).toHaveTextContent("Aucun contact");
    expect(screen.getByTestId("event-lead-count-upcoming-1")).toHaveTextContent(/^1 contact$/);
    expect(screen.getByTestId("event-phase-upcoming-1")).toHaveTextContent("À venir");
    expect(screen.getByTestId("event-phase-past-1")).toHaveTextContent("Passé");
  });

  test("EDI-009 three groups with their counts, empty ones are left out", () => {
    renderList([running, open, past]);
    const runningGroup = screen.getByTestId("events-group-running");
    expect(within(runningGroup).getByRole("heading", { name: "En cours" })).toBeVisible();
    expect(runningGroup).toHaveTextContent("2");
    expect(within(runningGroup).getByTestId("event-row-running-1")).toBeVisible();
    expect(within(screen.getByTestId("events-group-past")).getByTestId("event-row-past-1")).toBeVisible();
    expect(screen.queryByTestId("events-group-upcoming")).toBeNull();
  });

  test("EDI-009 the groups follow the server phase, not the dates", () => {
    // Its dates are in the past for the clock of the browser; the server says it is upcoming.
    renderList([eventView({ id: "x", phase: "upcoming", starts_at: "2020-01-01T10:00:00Z" })]);
    expect(within(screen.getByTestId("events-group-upcoming")).getByTestId("event-row-x")).toBeVisible();
  });

  test("EVT-006 EVT-021 end now is offered on running events only", () => {
    renderList();
    expect(screen.getByTestId("event-end-now-running-1")).toHaveTextContent("Terminer");
    expect(screen.getByTestId("event-end-now-running-2")).toBeInTheDocument();
    expect(screen.queryByTestId("event-end-now-upcoming-1")).toBeNull();
    expect(screen.queryByTestId("event-end-now-past-1")).toBeNull();
  });

  test("EVT-006 EVT-009 ending an event calls the API, then reloads", async () => {
    const onChanged = renderList();
    fireEvent.click(screen.getByTestId("event-end-now-running-1"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/events/{id}/end", { params: { path: { id: "running-1" } } }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  test("EVT-021 an event that is no longer running explains why it cannot be ended", async () => {
    post.mockRejectedValue(new ApiError({ status: 409, code: "event_not_running", message: "no", requestId: "r1" }));
    const onChanged = renderList();
    fireEvent.click(screen.getByTestId("event-end-now-running-1"));
    expect(await screen.findByTestId("event-action-error")).toHaveTextContent("n’est pas en cours");
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getByTestId("event-end-now-running-1")).toBeEnabled();
  });

  test("EDI-009 any other failure shows the generic notice with the request id", async () => {
    post.mockRejectedValue(new ApiError({ status: 500, code: "internal_error", message: "Boom.", requestId: "req-500" }));
    renderList();
    fireEvent.click(screen.getByTestId("event-end-now-running-1"));
    expect(await screen.findByTestId("error-request-id")).toHaveTextContent("req-500");
  });

  test("EDI-009 the buttons of an event stay disabled until the list reloads", async () => {
    let finishReload: () => void = () => undefined;
    const onChanged = vi.fn(() => new Promise<void>((resolve) => (finishReload = resolve)));
    renderList([running, upcoming], onChanged);
    fireEvent.click(screen.getByTestId("event-end-now-running-1"));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("event-end-now-running-1")).toBeDisabled();
    expect(screen.getByTestId("event-delete-running-1")).toBeDisabled();
    finishReload();
    await waitFor(() => expect(screen.getByTestId("event-end-now-running-1")).toBeEnabled());
  });

  test("EVT-024 EDI-033 delete asks for confirmation, then calls the API and reloads", async () => {
    const onChanged = renderList();
    fireEvent.click(screen.getByRole("button", { name: "Supprimer Salon du Mariage ✨" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Supprimer « Salon du Mariage ✨ » ?");
    expect(del).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByTestId("event-delete-cancel"));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(del).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("event-delete-running-1"));
    fireEvent.click(await screen.findByTestId("event-delete-confirm"));
    await waitFor(() => expect(del).toHaveBeenCalledWith("/api/events/{id}", { params: { path: { id: "running-1" } } }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  test("EDI-033 closing the deletion dialog returns the focus to the delete button of the row", async () => {
    renderList();
    fireEvent.click(screen.getByTestId("event-delete-running-1"));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByTestId("event-delete-cancel"));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.getByTestId("event-delete-running-1")).toHaveFocus();
  });

  test("EDI-033 the deletion dialog counts the contacts and offers the export", async () => {
    renderList();
    fireEvent.click(screen.getByTestId("event-delete-running-1"));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Les 3 contacts collectés pendant cet événement seront supprimés avec lui, définitivement.");
    expect(dialog).toHaveTextContent("Exporte-les d’abord si tu veux les garder.");
    expect(within(dialog).getByTestId("event-delete-confirm")).toHaveTextContent("Supprimer l’événement et 3 contacts");

    fireEvent.click(within(dialog).getByTestId("event-delete-export"));
    expect(await screen.findByTestId("export-download")).toBeVisible();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    // Closing the export brings the confirmation back.
    fireEvent.click(screen.getByTestId("export-cancel"));
    expect(await screen.findByRole("alertdialog")).toBeVisible();
  });

  test("EDI-033 the dialog counts one contact", async () => {
    renderList();
    fireEvent.click(screen.getByTestId("event-delete-upcoming-1"));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Le contact collecté pendant cet événement sera supprimé avec lui, définitivement.");
    expect(dialog).not.toHaveTextContent("Les 1 contact");
    expect(within(dialog).getByTestId("event-delete-confirm")).toHaveTextContent(/^Supprimer l’événement et 1 contact$/);
    expect(within(dialog).getByTestId("event-delete-export")).toBeVisible();
  });

  test("EDI-033 with no contact the dialog neither counts nor offers the export", async () => {
    renderList();
    fireEvent.click(screen.getByTestId("event-delete-running-2"));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("n’a collecté aucun contact");
    expect(dialog).not.toHaveTextContent("0 contact");
    expect(within(dialog).getByTestId("event-delete-confirm")).toHaveTextContent(/^Supprimer l’événement$/);
    expect(within(dialog).queryByTestId("event-delete-export")).toBeNull();
  });

  test("EDI-032 the limit message appears at the instance's maximum", () => {
    renderList([running, open, eventView({ id: "r3", phase: "running" }), upcoming], undefined, 3);
    const limit = screen.getByTestId("events-limit");
    expect(limit).toHaveTextContent("3 événements en cours : c’est le maximum par carte.");
    expect(limit).toHaveTextContent("Tu peux toujours en programmer à venir.");
    expect(screen.getByTestId("events-info")).toHaveTextContent("Jusqu’à 3 événements en cours en même temps.");
  });

  test("EDI-032 below the maximum there is no limit message, and the maximum comes from the instance", () => {
    renderList([running, open, upcoming], undefined, 4);
    expect(screen.queryByTestId("events-limit")).toBeNull();
    expect(screen.getByTestId("events-info")).toHaveTextContent("Jusqu’à 4 événements");
  });

  test("EDI-032 no event: Aucun événement and a create button", () => {
    renderList([]);
    expect(screen.getByRole("heading", { name: "Aucun événement" })).toBeVisible();
    expect(screen.getByText(/Crée un événement pour ton prochain salon/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Créer un événement" })).toHaveAttribute("href", "/dashboard/cards/c1/events/new");
    expect(screen.queryByTestId("events-group-running")).toBeNull();
  });

  test("EDI-018 a row shows the access code or says there is none", () => {
    renderList([eventView({ id: "c", access_code: "SALON27", phase: "running" }), upcoming]);
    expect(screen.getByTestId("event-row-c")).toHaveTextContent("Code d’accès SALON27");
    expect(screen.getByTestId("event-row-upcoming-1")).toHaveTextContent("Sans code d’accès");
  });
});
