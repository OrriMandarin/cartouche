import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, test, vi } from "vitest";
import messages from "../../../messages/fr.json";

let pathname = "/dashboard";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

import { AppShell } from "./AppShell";

function renderShell(path: string, props: Partial<React.ComponentProps<typeof AppShell>> = {}) {
  pathname = path;
  return render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <AppShell user={{ name: "Éloïse D’Aubigné-Müller", email: "eloise@example.test" }} onSignOut={() => undefined} {...props}>
        <p data-testid="page">contenu</p>
      </AppShell>
    </NextIntlClientProvider>,
  );
}

describe("AppShell", () => {
  test("EDI-022 the side bar lists Mes cartes, Contacts and Mon compte, the current one marked", () => {
    renderShell("/dashboard/contacts");
    const [side] = screen.getAllByRole("navigation", { name: "Navigation principale" });
    const links = within(side!).getAllByRole("link");
    expect(links.map((l) => [l.textContent, l.getAttribute("href")])).toEqual([
      ["Mes cartes", "/dashboard"],
      ["Contacts", "/dashboard/contacts"],
      ["Mon compte", "/dashboard/account"],
    ]);
    expect(within(side!).getByTestId("nav-contacts")).toHaveAttribute("aria-current", "page");
    expect(within(side!).getByTestId("nav-cards")).not.toHaveAttribute("aria-current");
    expect(within(side!).getByTestId("account-link")).toHaveAttribute("href", "/dashboard/account");
  });

  test("ADM-001 the Support entry shows only for administrators, in the side bar and the tab bar", () => {
    const { unmount } = renderShell("/dashboard");
    expect(screen.queryByTestId("nav-support")).toBeNull();
    expect(screen.queryByTestId("tab-support")).toBeNull();
    unmount();

    renderShell("/support/users/u1", { isAdmin: true });
    const [side] = screen.getAllByRole("navigation", { name: "Navigation principale" });
    expect(within(side!).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Mes cartes",
      "Contacts",
      "Mon compte",
      "Support",
    ]);
    expect(screen.getByTestId("nav-support")).toHaveAttribute("href", "/support");
    expect(screen.getByTestId("nav-support")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("tab-support")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("account-link")).not.toHaveAttribute("aria-current");
  });

  test("EDI-022 the pages of a card keep Mes cartes current", () => {
    renderShell("/dashboard/cards/abc/events");
    expect(screen.getByTestId("nav-cards")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("tab-cards")).toHaveAttribute("aria-current", "page");
  });

  test("EDI-022 the side bar shows the user's name and email", () => {
    renderShell("/dashboard");
    expect(screen.getByTestId("shell-user-name")).toHaveTextContent("Éloïse D’Aubigné-Müller");
    expect(screen.getByTestId("shell-user-email")).toHaveTextContent("eloise@example.test");
  });

  test("EDI-022 the tab bar is shown without a save bar", () => {
    renderShell("/dashboard");
    expect(screen.getAllByRole("navigation", { name: "Navigation principale" })).toHaveLength(2);
    expect(screen.getByTestId("tab-cards")).toBeInTheDocument();
  });

  test("EDI-022 a save bar replaces the tab bar", () => {
    renderShell("/dashboard", { saveBar: <div data-testid="save-bar">Enregistrer</div> });
    expect(screen.getByTestId("save-bar")).toBeInTheDocument();
    expect(screen.getAllByRole("navigation", { name: "Navigation principale" })).toHaveLength(1);
    expect(screen.queryByTestId("tab-cards")).toBeNull();
  });

  test("EDI-022 a breadcrumb and a phone app bar with back, title and action", () => {
    renderShell("/dashboard/cards/new", {
      breadcrumb: [{ label: "Mes cartes", href: "/dashboard" }, { label: "Nouvelle carte" }],
      title: "Nouvelle carte",
      back: { href: "/dashboard", label: "Mes cartes" },
      action: <button type="button">Aller</button>,
    });
    const crumbs = screen.getByRole("navigation", { name: "Fil d’Ariane" });
    expect(within(crumbs).getByRole("link", { name: "Mes cartes" })).toHaveAttribute("href", "/dashboard");
    expect(within(crumbs).getByText("Nouvelle carte")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("shell-back")).toHaveAttribute("href", "/dashboard");
    expect(screen.getByTestId("shell-title")).toHaveTextContent("Nouvelle carte");
    expect(screen.getByRole("button", { name: "Aller" })).toBeInTheDocument();
  });

  test("EDI-022 the content is limited to 1160 px", () => {
    renderShell("/dashboard");
    expect(screen.getByTestId("page").parentElement).toHaveClass("max-w-[1160px]");
  });
});
