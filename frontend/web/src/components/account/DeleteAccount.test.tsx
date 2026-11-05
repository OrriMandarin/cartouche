import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ApiError } from "@cartouche/api-client";
import messages from "../../../messages/fr.json";

const del = vi.fn();
const api = { DELETE: del };
vi.mock("@/lib/api", () => ({ useApi: () => api }));
const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

import { DeleteAccount } from "./DeleteAccount";

function renderComponent(isAdmin = false, totals = { cards: 4, events: 7, leads: 164 }) {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <DeleteAccount isAdmin={isAdmin} totals={totals} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  del.mockReset();
  replace.mockReset();
});

describe("DeleteAccount", () => {
  test("ACC-020 the delete button waits for SUPPRIMER, then deletes and leaves", async () => {
    del.mockResolvedValue({ response: new Response(null, { status: 204 }) });
    renderComponent();
    fireEvent.click(screen.getByTestId("delete-account-open"));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("sans retour possible");
    expect(dialog).toHaveTextContent("Les médias de tes cartes");
    expect(dialog).toHaveTextContent("bloqués définitivement");
    expect(dialog).toHaveTextContent("ne sera pas supprimé");
    expect(screen.getByLabelText("Pour confirmer, tape SUPPRIMER")).toBe(screen.getByTestId("delete-account-input"));

    expect(screen.getByTestId("delete-account-confirm")).toBeDisabled();
    fireEvent.change(screen.getByTestId("delete-account-input"), { target: { value: "suppr" } });
    expect(screen.getByTestId("delete-account-confirm")).toBeDisabled();
    fireEvent.change(screen.getByTestId("delete-account-input"), { target: { value: " supprimer " } });
    expect(screen.getByTestId("delete-account-confirm")).toBeEnabled();

    fireEvent.click(screen.getByTestId("delete-account-confirm"));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/account-deleted"));
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith("/api/me");
  });

  test.each([
    [{ cards: 0, events: 0, leads: 0 }, ["aucune carte\u00a0;", "aucun événement\u00a0;", "aucun contact collecté."]],
    [
      { cards: 1, events: 1, leads: 1 },
      ["ta carte et sa page publique\u00a0;", "ton événement et son formulaire\u00a0;", "le contact collecté."],
    ],
  ])("ACC-027 the confirmation list reads correctly for %j", async (totals, expected) => {
    renderComponent(false, totals);
    fireEvent.click(screen.getByTestId("delete-account-open"));
    const items = (await screen.findAllByRole("listitem")).map((item) => item.textContent);
    expect(items).toEqual(expected);
  });

  test("ACC-020 cancelling sends nothing and empties the confirmation", async () => {
    renderComponent();
    fireEvent.click(screen.getByTestId("delete-account-open"));
    fireEvent.change(await screen.findByTestId("delete-account-input"), { target: { value: "SUPPRIMER" } });
    fireEvent.click(screen.getByTestId("delete-account-cancel"));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    fireEvent.click(screen.getByTestId("delete-account-open"));
    expect(await screen.findByTestId("delete-account-input")).toHaveValue("");
    expect(del).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  test("ACC-021 an administrator gets an explanation instead of the button", () => {
    renderComponent(true);
    expect(screen.getByTestId("delete-account-admin")).toHaveTextContent("retirer de ADMIN_USER_IDS");
    expect(screen.queryByTestId("delete-account-open")).toBeNull();
  });

  test("ACC-021 a refusal for an administrator has its own message", async () => {
    del.mockRejectedValue(new ApiError({ status: 403, code: "cannot_delete_admin", message: "no", requestId: "r-1" }));
    renderComponent();
    fireEvent.click(screen.getByTestId("delete-account-open"));
    fireEvent.change(await screen.findByTestId("delete-account-input"), { target: { value: "SUPPRIMER" } });
    fireEvent.click(screen.getByTestId("delete-account-confirm"));
    expect(await screen.findByTestId("delete-account-admin-refused")).toHaveTextContent("ADMIN_USER_IDS");
    expect(screen.queryByTestId("error-notice")).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  test("ACC-022 a failure shows the request id and allows trying again", async () => {
    del.mockRejectedValue(new ApiError({ status: 500, code: "internal_error", message: "boom", requestId: "req-42" }));
    renderComponent();
    fireEvent.click(screen.getByTestId("delete-account-open"));
    fireEvent.change(await screen.findByTestId("delete-account-input"), { target: { value: "SUPPRIMER" } });
    fireEvent.click(screen.getByTestId("delete-account-confirm"));
    expect(await screen.findByTestId("error-request-id")).toHaveTextContent("req-42");
    expect(replace).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId("delete-account-confirm")).toBeEnabled());
  });

  test("ACC-023 an account that vanished meanwhile counts as deleted", async () => {
    del.mockRejectedValue(new ApiError({ status: 404, code: "not_found", message: "gone", requestId: "r-2" }));
    renderComponent();
    fireEvent.click(screen.getByTestId("delete-account-open"));
    fireEvent.change(await screen.findByTestId("delete-account-input"), { target: { value: "SUPPRIMER" } });
    fireEvent.click(screen.getByTestId("delete-account-confirm"));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/account-deleted"));
    expect(screen.queryByTestId("error-notice")).toBeNull();
  });
});
