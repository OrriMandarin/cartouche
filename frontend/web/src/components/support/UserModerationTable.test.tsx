import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ApiError } from "@cartouche/api-client";
import messages from "../../../messages/fr.json";

const post = vi.fn();
const api = { POST: post };
vi.mock("@/lib/api", () => ({ useApi: () => api }));

import { UserModerationTable, type ModerationUser } from "./UserModerationTable";

function user(overrides: Partial<ModerationUser>): ModerationUser {
  return {
    id: "id-1",
    subject: "seed-carol",
    email: "carol@example.test",
    display_name: "Carol",
    status: "pending",
    is_admin: false,
    created_at: "2026-03-05T12:00:00Z",
    ...overrides,
  };
}

function renderTable(users: ModerationUser[], onChanged: () => void | Promise<void> = () => undefined) {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <UserModerationTable users={users} onChanged={onChanged} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  post.mockReset();
});

describe("UserModerationTable", () => {
  test("ADM-004: admins have no action buttons", () => {
    renderTable([user({ subject: "seed-admin", status: "approved", is_admin: true, display_name: "Admin" })]);
    const row = screen.getByTestId("user-row-seed-admin");
    expect(row).toHaveTextContent("Admin");
    expect(row.querySelectorAll("button")).toHaveLength(0);
  });

  test("ADM-003: shows only the allowed actions, with their labels", () => {
    renderTable([
      user({ subject: "p", status: "pending" }),
      user({ subject: "a", status: "approved" }),
      user({ subject: "s", status: "suspended" }),
      user({ subject: "r", status: "rejected" }),
    ]);
    expect(screen.getByTestId("set-status-p-approved")).toHaveTextContent("Valider");
    expect(screen.getByTestId("set-status-p-rejected")).toHaveTextContent("Refuser");
    expect(screen.queryByTestId("set-status-p-suspended")).toBeNull();
    expect(screen.getByTestId("set-status-a-suspended")).toHaveTextContent("Suspendre");
    expect(screen.queryByTestId("set-status-a-approved")).toBeNull();
    expect(screen.getByTestId("set-status-s-approved")).toHaveTextContent("Réactiver");
    expect(screen.getByTestId("set-status-r-approved")).toHaveTextContent("Réactiver");
  });

  test("shows name, email, subject, status badge and the date in French", () => {
    renderTable([user({})]);
    const row = screen.getByTestId("user-row-seed-carol");
    expect(row).toHaveTextContent("Carol");
    expect(row).toHaveTextContent("carol@example.test");
    expect(row).toHaveTextContent("seed-carol");
    expect(row).toHaveTextContent("En attente");
    expect(row).toHaveTextContent("5 mars 2026");
  });

  test("ADM-006: the name links to the account's page", () => {
    renderTable([user({ id: "id-carol", subject: "seed-carol" })]);
    expect(screen.getByTestId("user-link-seed-carol")).toHaveAttribute("href", "/support/users/id-carol");
    expect(screen.getByTestId("user-link-seed-carol")).toHaveTextContent("Carol");
  });

  test("falls back to email then subject when there is no display name", () => {
    renderTable([
      user({ subject: "s1", display_name: null, email: "x@example.test" }),
      user({ subject: "s2", display_name: null, email: null }),
    ]);
    expect(screen.getByTestId("user-name-s1")).toHaveTextContent("x@example.test");
    expect(screen.getByTestId("user-name-s2")).toHaveTextContent("s2");
  });

  test("ADM-002: approve calls API then reloads", async () => {
    post.mockResolvedValue({ data: {} });
    const onChanged = vi.fn();
    renderTable([user({})], onChanged);
    fireEvent.click(screen.getByTestId("set-status-seed-carol-approved"));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith("/api/admin/users/{id}/status", {
      params: { path: { id: "id-1" } },
      body: { status: "approved" },
    });
  });

  test("shows the message with the request id after a failed action, without reloading", async () => {
    post.mockRejectedValue(
      new ApiError({ status: 409, code: "invalid_transition", message: "no", requestId: "req-409" }),
    );
    const onChanged = vi.fn();
    renderTable([user({})], onChanged);
    fireEvent.click(screen.getByTestId("set-status-seed-carol-approved"));
    expect(await screen.findByTestId("error-request-id")).toHaveTextContent("req-409");
    expect(onChanged).not.toHaveBeenCalled();
  });
});
