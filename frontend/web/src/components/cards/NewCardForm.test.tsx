import { configure, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, test, vi } from "vitest";
import messages from "../../../messages/fr.json";
import { cardView } from "./card-view.fixture";

// The slug checks wait 300 ms each; leave room when the machine is busy.
configure({ asyncUtilTimeout: 4000 });

const get = vi.fn();
const post = vi.fn();
const api = { GET: get, POST: post };
vi.mock("@/lib/api", () => ({ useApi: () => api }));
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { NewCardForm } from "./NewCardForm";

function mockSlugs(suggestion: string | null, status = "free") {
  get.mockImplementation((path: string) =>
    Promise.resolve({ data: path === "/api/slugs/suggestion" ? { slug: suggestion } : { status, slug: null } }),
  );
}

function renderForm() {
  render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <NewCardForm />
    </NextIntlClientProvider>,
  );
}

function fillName(first: string, last: string) {
  fireEvent.change(screen.getByTestId("new-card-first-name"), { target: { value: first } });
  fireEvent.change(screen.getByTestId("new-card-last-name"), { target: { value: last } });
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  push.mockReset();
});

describe("NewCardForm", { timeout: 15_000 }, () => {
  test("EDI-013 LNK-019 proposes a slug from the name, creates the card and opens the editor", async () => {
    mockSlugs("alice-durand-2");
    post.mockResolvedValue({ data: cardView({ id: "new-id" }) });
    renderForm();
    expect(screen.getByTestId("new-card-submit")).toBeDisabled();
    fillName("Alice", "Durand");
    await waitFor(() => expect(screen.getByTestId("slug-input")).toHaveValue("alice-durand-2"));
    await waitFor(() => expect(screen.getByTestId("new-card-submit")).toBeEnabled());
    fireEvent.click(screen.getByTestId("new-card-submit"));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/api/cards", {
        body: { first_name: "Alice", last_name: "Durand", slug: "alice-durand-2" },
      }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard/cards/new-id"));
  });

  test("EDI-013 a slug typed by the user is not replaced by a later suggestion", async () => {
    mockSlugs("alice-durand-2");
    renderForm();
    fillName("Alice", "Durand");
    await waitFor(() => expect(screen.getByTestId("slug-input")).toHaveValue("alice-durand-2"));
    fireEvent.change(screen.getByTestId("slug-input"), { target: { value: "alice-cartes" } });
    mockSlugs("alice-martin-2");
    fillName("Alice", "Martin");
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(screen.getByTestId("slug-input")).toHaveValue("alice-cartes");
  });

  test("LNK-020 a taken slug disables the submit button", async () => {
    mockSlugs(null, "taken");
    renderForm();
    fireEvent.change(screen.getByTestId("slug-input"), { target: { value: "bob-martin" } });
    await waitFor(() => expect(screen.getByTestId("slug-status")).toHaveAttribute("data-status", "taken"));
    expect(screen.getByTestId("new-card-submit")).toBeDisabled();
    expect(post).not.toHaveBeenCalled();
  });
});
