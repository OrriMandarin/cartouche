import { cleanup, configure, act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ApiError } from "@cartouche/api-client";
import messages from "../../../messages/fr.json";
import { cardView } from "./card-view.fixture";

// The slug checks wait 300 ms each; leave room when the machine is busy.
configure({ asyncUtilTimeout: 4000 });

type CardCounts = { events: number; leads: number };

const get = vi.fn();
const post = vi.fn();
const del = vi.fn();
const api = { GET: get, POST: post, DELETE: del };
vi.mock("@/lib/api", () => ({ useApi: () => api }));

import { CardActions } from "./CardActions";

function openMenu() {
  fireEvent.keyDown(screen.getByRole("button", { name: /Plus d’actions pour/ }), { key: "Enter" });
}

function renderActions(card = cardView(), onChanged: () => Promise<void> = () => Promise.resolve()) {
  render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <CardActions card={card} onChanged={onChanged} />
    </NextIntlClientProvider>,
  );
  return onChanged;
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  del.mockReset();
  post.mockResolvedValue({ data: {} });
  del.mockResolvedValue({});
});

describe("CardActions", { timeout: 15_000 }, () => {
  test("LNK-011 LNK-036 support-disabled card offers no reactivation, edition or duplication", () => {
    renderActions(cardView({ status: "disabled_by_support" }));
    expect(screen.queryByTestId("card-edit-alice-durand")).toBeNull();
    openMenu();
    expect(screen.queryByTestId("card-enable-alice-durand")).toBeNull();
    expect(screen.queryByTestId("card-disable-alice-durand")).toBeNull();
    expect(screen.queryByTestId("card-duplicate-alice-durand")).toBeNull();
    expect(screen.getByTestId("card-open-alice-durand")).toHaveTextContent("Ouvrir la page publique");
    expect(screen.getByTestId("card-delete-alice-durand")).toBeInTheDocument();
  });

  test("EDI-023 an editable card has Modifier and the full menu", () => {
    renderActions();
    expect(screen.getByTestId("card-edit-alice-durand")).toHaveAttribute("href", "/dashboard/cards/card-1");
    openMenu();
    expect(screen.getByTestId("card-open-alice-durand")).toHaveAttribute("href", "http://localhost:13000/c/alice-durand");
    expect(screen.getByTestId("card-qr-svg-alice-durand")).toHaveTextContent("Télécharger le QR code (SVG)");
    expect(screen.getByTestId("card-qr-png-alice-durand")).toHaveTextContent("Télécharger le QR code (PNG)");
    expect(screen.getByTestId("card-duplicate-alice-durand")).toHaveTextContent("Dupliquer");
    expect(screen.getByTestId("card-disable-alice-durand")).toHaveTextContent("Désactiver");
    expect(screen.getByTestId("card-delete-alice-durand")).toHaveTextContent("Supprimer…");
  });

  test("LNK-005 an active card is disabled with one click, a disabled one enabled", async () => {
    const onChanged = renderActions(cardView({ status: "active" }));
    openMenu();
    expect(screen.queryByTestId("card-enable-alice-durand")).toBeNull();
    fireEvent.click(screen.getByTestId("card-disable-alice-durand"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/cards/{id}/disable", { params: { path: { id: "card-1" } } }));
    expect(onChanged).toBeDefined();
  });

  test("LNK-005 a disabled card is enabled with one click", async () => {
    renderActions(cardView({ status: "disabled" }));
    openMenu();
    expect(screen.queryByTestId("card-disable-alice-durand")).toBeNull();
    expect(screen.getByTestId("card-enable-alice-durand")).toHaveTextContent("Réactiver");
    fireEvent.click(screen.getByTestId("card-enable-alice-durand"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/cards/{id}/enable", { params: { path: { id: "card-1" } } }));
  });

  test("LNK-005 action buttons stay disabled until the list reloads", async () => {
    let finishReload: () => void = () => undefined;
    const onChanged = vi.fn(() => new Promise<void>((resolve) => (finishReload = resolve)));
    renderActions(cardView(), onChanged);
    openMenu();
    fireEvent.click(screen.getByTestId("card-disable-alice-durand"));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    openMenu();
    expect(await screen.findByTestId("card-disable-alice-durand")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("card-duplicate-alice-durand")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("card-delete-alice-durand")).toHaveAttribute("aria-disabled", "true");
    await act(async () => finishReload());
    await waitFor(() => expect(screen.getByTestId("card-delete-alice-durand")).not.toHaveAttribute("aria-disabled"));
  });

  test("LNK-005 a failed action shows the error with its request id and does not reload", async () => {
    post.mockRejectedValue(new ApiError({ status: 409, code: "card_disabled_by_support", message: "no", requestId: "req-409" }));
    const onChanged = vi.fn(() => Promise.resolve());
    renderActions(cardView(), onChanged);
    openMenu();
    fireEvent.click(screen.getByTestId("card-disable-alice-durand"));
    expect(await screen.findByTestId("error-request-id")).toHaveTextContent("req-409");
    expect(onChanged).not.toHaveBeenCalled();
  });

  test("EDI-002 LNK-012 EDI-024 the deletion dialog gives the slug and the counts", async () => {
    const onChanged = vi.fn(() => Promise.resolve());
    renderActions(cardView({ event_counts: { running: 3, upcoming: 1, past: 2 }, lead_count: 4 }), onChanged);
    openMenu();
    fireEvent.click(screen.getByTestId("card-delete-alice-durand"));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Supprimer cette carte ?");
    expect(dialog).toHaveTextContent("La carte alice-durand, ses 6 événements et ses 4 contacts seront supprimés définitivement.");
    expect(dialog).toHaveTextContent("afficheront « Cette carte n’est pas disponible »");
    expect(del).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByTestId("card-delete-cancel"));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(del).not.toHaveBeenCalled();

    openMenu();
    fireEvent.click(screen.getByTestId("card-delete-alice-durand"));
    fireEvent.click(await screen.findByTestId("card-delete-confirm"));
    await waitFor(() => expect(del).toHaveBeenCalledWith("/api/cards/{id}", { params: { path: { id: "card-1" } } }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  test("EDI-024 the deletion dialog reads well with one, zero and no contents", async () => {
    const cases: [CardCounts, string][] = [
      [{ events: 1, leads: 1 }, "La carte alice-durand, son événement et son contact seront supprimés définitivement."],
      [{ events: 0, leads: 3 }, "La carte alice-durand, aucun événement et ses 3 contacts seront supprimés définitivement."],
      [{ events: 0, leads: 0 }, "La carte alice-durand sera supprimée définitivement."],
    ];
    for (const [{ events, leads }, sentence] of cases) {
      renderActions(cardView({ event_counts: { running: 0, upcoming: events, past: 0 }, lead_count: leads }));
      openMenu();
      fireEvent.click(screen.getByTestId("card-delete-alice-durand"));
      expect(await screen.findByRole("alertdialog")).toHaveTextContent(sentence);
      cleanup();
    }
  });

  test("EDI-014 duplicate asks for a slug, proposed by the server", async () => {
    get.mockImplementation((path: string) =>
      Promise.resolve({ data: path === "/api/slugs/suggestion" ? { slug: "alice-durand-2" } : { status: "free", slug: "alice-durand-2" } }),
    );
    const onChanged = vi.fn(() => Promise.resolve());
    renderActions(cardView({ content: { first_name: "Alice", last_name: "Durand" } }), onChanged);
    openMenu();
    fireEvent.click(screen.getByTestId("card-duplicate-alice-durand"));
    const input = await screen.findByTestId("slug-input");
    await waitFor(() => expect(input).toHaveValue("alice-durand-2"));
    await waitFor(() => expect(screen.getByTestId("card-duplicate-confirm")).toBeEnabled());

    fireEvent.change(input, { target: { value: "alice-bis" } });
    await waitFor(() => expect(screen.getByTestId("slug-status")).toHaveAttribute("data-status", "free"));
    fireEvent.click(screen.getByTestId("card-duplicate-confirm"));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/api/cards/{id}/duplicate", {
        params: { path: { id: "card-1" } },
        body: { slug: "alice-bis" },
      }),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  test("EDI-014 LNK-020 a taken slug cannot be used for a duplicate", async () => {
    get.mockImplementation((path: string) =>
      Promise.resolve({ data: path === "/api/slugs/suggestion" ? { slug: null } : { status: "taken", slug: "bob-martin" } }),
    );
    renderActions();
    openMenu();
    fireEvent.click(screen.getByTestId("card-duplicate-alice-durand"));
    const input = await screen.findByTestId("slug-input");
    fireEvent.change(input, { target: { value: "bob-martin" } });
    await waitFor(() => expect(screen.getByTestId("slug-status")).toHaveAttribute("data-status", "taken"));
    expect(screen.getByTestId("card-duplicate-confirm")).toBeDisabled();
  });
});
