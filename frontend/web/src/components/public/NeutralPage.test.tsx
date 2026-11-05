import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, test } from "vitest";
import messages from "../../../messages/fr.json";
import { NeutralPage } from "./NeutralPage";

describe("NeutralPage", () => {
  test("LNK-034 the neutral page shows its title and text in the neutral theme", () => {
    const { container } = render(
      <NextIntlClientProvider locale="fr" messages={messages}>
        <NeutralPage />
      </NextIntlClientProvider>,
    );
    const unavailable = screen.getByTestId("card-unavailable");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Cette carte n’est pas disponible");
    expect(unavailable).toHaveTextContent("Le lien est peut-être incorrect, ou la carte n’est plus active.");
    expect(unavailable.closest("article")).toHaveClass("cc");

    const stage = container.querySelector<HTMLElement>(".cc-page");
    expect(stage?.style.getPropertyValue("--c-accent")).toBe("#1c1c1a");
    expect(stage?.style.getPropertyValue("--c-text")).toBe("#1c1c1a");
    expect(stage?.style.getPropertyValue("--c-bg")).toBe("#f5f5f3");
    expect(stage?.style.getPropertyValue("--c-bg-2")).toBe("#f5f5f3");
    expect(stage?.style.getPropertyValue("--fade")).toBe("0");
    expect(stage?.style.getPropertyValue("--radius-btn")).toBe("12px");
    expect(stage?.style.getPropertyValue("--font-title")).toContain("Inter");
    expect(stage?.querySelector(":scope > .cc-stage > article.cc")).not.toBeNull();
  });
});
