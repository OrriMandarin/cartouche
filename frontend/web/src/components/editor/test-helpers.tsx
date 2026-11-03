import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement } from "react";
import messages from "../../../messages/fr.json";

/** Renders under the real French catalogue, plus extra messages for what a test invents. */
export function renderWithIntl(ui: ReactElement, extraMessages: Record<string, unknown> = {}) {
  return render(
    <NextIntlClientProvider locale="fr" messages={{ ...messages, ...extraMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

/** Opens a Radix select with the keyboard and picks the option of that name. */
export async function chooseOption(trigger: HTMLElement, name: string) {
  fireEvent.keyDown(trigger, { key: "Enter" });
  fireEvent.click(await screen.findByRole("option", { name }));
}
