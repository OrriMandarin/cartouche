import { configure, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, test, vi } from "vitest";
import messages from "../../../messages/fr.json";

// The slug checks wait 300 ms each; leave room when the machine is busy.
configure({ asyncUtilTimeout: 4000 });

const get = vi.fn();
const api = { GET: get };
vi.mock("@/lib/api", () => ({ useApi: () => api }));

import { useSlugAvailability } from "@/lib/cards/slug-availability";
import { SlugField } from "./SlugField";

function Field({ value, onChange = () => undefined }: { value: string; onChange?: (value: string) => void }) {
  const { status, suggestions } = useSlugAvailability(value);
  return <SlugField value={value} onChange={onChange} status={status} suggestions={suggestions} />;
}

function answer(status: string, suggestions: string[] = []) {
  return Promise.resolve({ data: { status, slug: null, suggestions } });
}

function renderField(value: string, onChange?: (value: string) => void) {
  render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <Field value={value} {...(onChange ? { onChange } : {})} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  get.mockReset();
});

describe("SlugField", () => {
  test("LNK-020 shows when the slug is taken", async () => {
    get.mockReturnValue(answer("taken"));
    renderField("bob-martin");
    expect(await screen.findByText("Ce lien est déjà pris. Choisis-en un autre.")).toBeInTheDocument();
    expect(screen.getByTestId("slug-status")).toHaveAttribute("data-status", "taken");
  });

  test("LNK-020 shows when the slug is invalid", async () => {
    get.mockReturnValue(answer("invalid"));
    renderField("a");
    expect(await screen.findByText("Invalide")).toBeInTheDocument();
  });

  test("LNK-020 shows when the slug is free", async () => {
    get.mockReturnValue(answer("free"));
    renderField("alice-durand-2");
    expect(await screen.findByText("Ce lien est disponible.")).toBeInTheDocument();
  });

  test("LNK-020 says it is checking while waiting for the server", () => {
    get.mockReturnValue(new Promise(() => undefined));
    renderField("alice-durand-2");
    expect(screen.getByText("Vérification…")).toBeInTheDocument();
  });

  test("LNK-020 shows nothing for an empty slug", () => {
    renderField("");
    expect(screen.getByTestId("slug-status")).toHaveAttribute("data-status", "idle");
    expect(get).not.toHaveBeenCalled();
  });

  test("LNK-020 typing calls onChange", async () => {
    const onChange = vi.fn();
    renderField("", onChange);
    fireEvent.change(screen.getByTestId("slug-input"), { target: { value: "abc" } });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("abc"));
  });

  test("LNK-035 a taken slug offers its suggestions, each fills the field", async () => {
    get.mockReturnValue(answer("taken", ["bob-martin-2", "bob-martin-3", "bob-martin-4"]));
    const onChange = vi.fn();
    renderField("bob-martin", onChange);
    expect(await screen.findAllByTestId(/^slug-suggestion-/)).toHaveLength(3);
    expect(screen.getByTestId("slug-status")).toHaveTextContent(/Ce lien est déjà pris\. Choisis-en un autre ou prends une suggestion/);
    fireEvent.click(screen.getByTestId("slug-suggestion-bob-martin-3"));
    expect(onChange).toHaveBeenCalledWith("bob-martin-3");
  });

  test("LNK-035 a free slug offers no suggestion", async () => {
    get.mockReturnValue(answer("free"));
    renderField("alice-durand-2");
    await screen.findByText("Ce lien est disponible.");
    expect(screen.queryAllByTestId(/^slug-suggestion-/)).toHaveLength(0);
  });

  test("LNK-035 a reserved slug offers its suggestions too", async () => {
    get.mockReturnValue(answer("reserved", ["alice-durand-2"]));
    renderField("alice-durand");
    expect(await screen.findAllByTestId(/^slug-suggestion-/)).toHaveLength(1);
  });
});
