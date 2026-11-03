import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, test, vi } from "vitest";
import messages from "../../../messages/fr.json";
import { cardView } from "./card-view.fixture";

vi.mock("@/lib/api", () => ({ useApi: () => ({}) }));

import { CardList } from "./CardList";

function renderList(cards: ReturnType<typeof cardView>[]) {
  render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <CardList cards={cards} onChanged={() => Promise.resolve()} />
    </NextIntlClientProvider>,
  );
}

describe("CardList", () => {
  test("EDI-012 shows name, public link and status of every card", () => {
    renderList([
      cardView(),
      cardView({
        id: "card-2",
        slug: "alice-archive",
        public_url: "http://localhost:13000/c/alice-archive",
        status: "disabled",
        content: {},
      }),
      cardView({ id: "card-3", slug: "bob-martin", status: "disabled_by_support", public_url: "http://localhost:13000/c/bob-martin" }),
    ]);
    expect(screen.getByTestId("card-name-alice-durand")).toHaveTextContent("Éloïse D'Aubigné-Müller");
    expect(screen.getByTestId("card-url-alice-durand")).toHaveTextContent("http://localhost:13000/c/alice-durand");
    expect(screen.getByTestId("card-url-alice-durand")).toHaveAttribute("href", "http://localhost:13000/c/alice-durand");
    expect(screen.getByTestId("card-status-alice-durand")).toHaveTextContent("Active");
    expect(screen.getByTestId("card-name-alice-archive")).toHaveTextContent("Carte sans nom");
    expect(screen.getByTestId("card-status-alice-archive")).toHaveTextContent("Désactivée");
    expect(screen.getByTestId("card-status-bob-martin")).toHaveTextContent("Désactivée par le support");
  });
});
