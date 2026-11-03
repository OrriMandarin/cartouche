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
  const { status } = useSlugAvailability(value);
  return <SlugField value={value} onChange={onChange} status={status} />;
}

function answer(status: string) {
  return Promise.resolve({ data: { status, slug: null } });
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
    expect(await screen.findByText("Déjà pris")).toBeInTheDocument();
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
    expect(await screen.findByText("Disponible")).toBeInTheDocument();
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
});
