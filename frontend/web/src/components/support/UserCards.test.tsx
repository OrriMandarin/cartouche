import { screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { cardView } from "@/components/cards/card-view.fixture";
import { renderWithIntl } from "@/components/editor/test-helpers";
import { UserCards } from "./UserCards";

const alice = {
  id: "user-alice",
  subject: "seed-alice",
  email: "alice@example.test",
  display_name: "Alice",
  status: "approved" as const,
  is_admin: false,
  created_at: "2026-03-05T12:00:00Z",
};

describe("UserCards", () => {
  test("ADM-006 shows the profile: name, email and status", () => {
    renderWithIntl(<UserCards user={alice} cards={[]} />);
    expect(screen.getByTestId("support-user-name")).toHaveTextContent("Alice");
    expect(screen.getByTestId("support-user-email")).toHaveTextContent("alice@example.test");
    expect(screen.getByTestId("support-user-status")).toHaveTextContent("Validé");
  });

  test("ADM-013 lists every card with name, slug, status and a « Voir » link, even a disabled one", () => {
    renderWithIntl(
      <UserCards
        user={alice}
        cards={[
          cardView({ id: "c1", slug: "alice-durand", content: { first_name: "Éloïse", last_name: "Müller" } }),
          cardView({ id: "c2", slug: "alice-archive", status: "disabled_by_support" }),
        ]}
      />,
    );
    const active = screen.getByTestId("support-card-row-alice-durand");
    expect(active).toHaveTextContent("Éloïse Müller");
    expect(active).toHaveTextContent("alice-durand");
    expect(screen.getByTestId("card-status-alice-durand")).toHaveTextContent("Active");
    expect(screen.getByTestId("support-card-view-alice-durand")).toHaveAttribute("href", "/support/cards/c1");
    expect(screen.getByTestId("card-status-alice-archive")).toHaveTextContent("Désactivée par le support");
    expect(screen.getByTestId("support-card-view-alice-archive")).toHaveAttribute("href", "/support/cards/c2");
  });

  test("ADM-006 an account without card says so", () => {
    renderWithIntl(<UserCards user={alice} cards={[]} />);
    expect(screen.getByTestId("support-user-no-cards")).toHaveTextContent("Cet utilisateur n'a aucune carte.");
  });
});
