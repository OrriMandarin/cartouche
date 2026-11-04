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

function renderComponent(isAdmin = false) {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <DeleteAccount isAdmin={isAdmin} />
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

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("supprimés pour toujours");
    expect(dialog).toHaveTextContent("bloqués définitivement");
    expect(dialog).toHaveTextContent("ne sera pas supprimé");
    expect(screen.getByLabelText("Tape SUPPRIMER pour confirmer")).toBe(screen.getByTestId("delete-account-input"));

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

  test("ACC-020 cancelling sends nothing and empties the confirmation", async () => {
    renderComponent();
    fireEvent.click(screen.getByTestId("delete-account-open"));
    fireEvent.change(await screen.findByTestId("delete-account-input"), { target: { value: "SUPPRIMER" } });
    fireEvent.click(screen.getByTestId("delete-account-cancel"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
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
