import { fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, test, vi } from "vitest";
import messages from "../../../messages/fr.json";
import { cardView } from "./card-view.fixture";

vi.mock("@/lib/api", () => ({ useApi: () => ({}) }));

import { CardList, CardListEmpty, CardListSkeleton } from "./CardList";

function renderInIntl(node: React.ReactNode) {
  render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      {node}
    </NextIntlClientProvider>,
  );
}

function renderList(cards: ReturnType<typeof cardView>[]) {
  renderInIntl(<CardList cards={cards} onChanged={() => Promise.resolve()} />);
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

  test("EDI-023 each row links to its events with the summary, and the list explains disabled cards", () => {
    renderList([
      cardView({ event_counts: { running: 1, upcoming: 1, past: 4 } }),
      cardView({ id: "card-2", slug: "second", event_counts: { running: 0, upcoming: 2, past: 0 } }),
      cardView({ id: "card-3", slug: "third", event_counts: { running: 0, upcoming: 0, past: 5 } }),
    ]);
    const first = screen.getByTestId("card-events-alice-durand");
    expect(first).toHaveTextContent("1 en cours · 1 à venir");
    expect(first).toHaveAttribute("href", "/dashboard/cards/card-1/events");
    expect(screen.getByTestId("card-events-second")).toHaveTextContent("2 à venir");
    expect(screen.getByTestId("card-events-third")).toHaveTextContent("Aucun événement à venir");
    expect(screen.getByText(/Une carte désactivée affiche la page/)).toBeInTheDocument();
  });

  test("EDI-023 the thumbnail carries the card theme variables and the initials", () => {
    renderList([cardView({ theme: { preset: "craie" }, content: { first_name: "Éloïse", last_name: "D'Aubigné-Müller" } })]);
    const thumbnail = within(screen.getByTestId("card-row-alice-durand")).getByTestId("card-thumbnail");
    expect(thumbnail.style.getPropertyValue("--c-accent")).not.toBe("");
    expect(thumbnail).toHaveTextContent("ÉD");
  });

  test("LNK-036 a card blocked by support has no edit action and offers support", () => {
    renderList([cardView({ slug: "bob-martin", status: "disabled_by_support" })]);
    expect(screen.queryByTestId("card-edit-bob-martin")).toBeNull();
    expect(screen.getByTestId("card-support-bob-martin")).toHaveTextContent("Contacter le support");
    expect(screen.getByTestId("card-support-bob-martin").getAttribute("href")).toMatch(/^mailto:/);
    fireEvent.keyDown(screen.getByTestId("card-menu-bob-martin"), { key: "Enter" });
    expect(screen.queryByTestId("card-duplicate-bob-martin")).toBeNull();
    expect(screen.queryByTestId("card-enable-bob-martin")).toBeNull();
    expect(screen.queryByTestId("card-disable-bob-martin")).toBeNull();
  });

  test("EDI-025 no card: one button to create the first one", () => {
    renderInIntl(<CardListEmpty />);
    expect(screen.getByRole("heading", { name: "Crée ta première carte" })).toBeInTheDocument();
    const buttons = screen.getAllByRole("link");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveTextContent("Créer une carte");
    expect(buttons[0]).toHaveAttribute("href", "/dashboard/cards/new");
  });

  test("EDI-025 the loading state is announced as busy", () => {
    renderInIntl(<CardListSkeleton />);
    expect(screen.getByLabelText("Chargement des cartes")).toHaveAttribute("aria-busy", "true");
  });
});
