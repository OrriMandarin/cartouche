import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, test } from "vitest";
import messages from "../../messages/fr.json";
import { TestModeBanner, isTestModeProfile } from "./TestModeBanner";

function renderBanner(profile: "development" | "test" | "production") {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <TestModeBanner profile={profile} />
    </NextIntlClientProvider>,
  );
}

describe("TestModeBanner", () => {
  test("ACC-009: shows banner in test profile", () => {
    renderBanner("test");
    const banner = screen.getByTestId("test-mode-banner");
    expect(banner).toHaveTextContent("MODE TEST — données fictives");
    expect(banner).toHaveAttribute("role", "status");
  });

  test("ACC-009: shows banner in development profile", () => {
    renderBanner("development");
    expect(screen.getByTestId("test-mode-banner")).toBeInTheDocument();
  });

  test("ACC-009: hides banner in production profile", () => {
    renderBanner("production");
    expect(screen.queryByTestId("test-mode-banner")).toBeNull();
  });
});

describe("isTestModeProfile", () => {
  test("ACC-009: only development and test show the banner", () => {
    expect(isTestModeProfile("development")).toBe(true);
    expect(isTestModeProfile("test")).toBe(true);
    expect(isTestModeProfile("production")).toBe(false);
    expect(isTestModeProfile(undefined)).toBe(false);
  });
});
