import { fireEvent, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, test, vi } from "vitest";
import type { ThemeSettings } from "@/lib/theme/presets";
import { ThemeEditor } from "./ThemeEditor";
import { chooseOption, renderWithIntl } from "./test-helpers";

function Harness({
  initial,
  onChange,
  disabled,
}: {
  initial: ThemeSettings;
  onChange: (theme: ThemeSettings) => void;
  disabled?: boolean;
}) {
  const [theme, setTheme] = useState(initial);
  return (
    <ThemeEditor
      theme={theme}
      disabled={disabled}
      onChange={(next) => {
        setTheme(next);
        onChange(next);
      }}
    />
  );
}

function renderEditor(initial: ThemeSettings = { preset: "craie" }, disabled = false) {
  const onChange = vi.fn<(theme: ThemeSettings) => void>();
  renderWithIntl(<Harness initial={initial} onChange={onChange} disabled={disabled} />);
  return onChange;
}

const lastTheme = (onChange: ReturnType<typeof renderEditor>) => onChange.mock.lastCall![0];

const UNREADABLE_TEXT: ThemeSettings = { preset: "terracotta", text: "#b89580" };

describe("ThemeEditor", () => {
  test("TPL-013 an unreadable text colour shows its ratio under the setting and says the card cannot be saved", () => {
    renderEditor(UNREADABLE_TEXT);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Texte illisible sur ce fond.");
    expect(alert).toHaveTextContent("Contraste 2,0:1, il faut au moins 4,5:1.");
    expect(alert).toHaveTextContent("La carte ne peut pas être enregistrée ainsi.");
    expect(screen.getByTestId("theme-text")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByTestId("theme-text")).toHaveAccessibleDescription(/Texte illisible sur ce fond/);
    expect(screen.queryByText(/Lisible/)).toBeNull();
  });

  test("TPL-013 an accent too close to the background names the required 3:1", () => {
    renderEditor({ preset: "craie", accent: "#f0efe9" });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Couleur d’accent trop proche du fond.");
    expect(alert).toHaveTextContent("il faut au moins 3:1.");
  });

  test("TPL-024 the readable colour button replaces the setting with the preset value, printed in capitals", () => {
    const onChange = renderEditor(UNREADABLE_TEXT);
    fireEvent.click(screen.getByRole("button", { name: "Utiliser une couleur lisible (#3B2117)" }));
    expect(lastTheme(onChange)).toEqual({ preset: "terracotta", text: "#3b2117" });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByTestId("theme-text")).toHaveValue("#3b2117");
  });

  test("TPL-024 no button when no colour can fix the setting", () => {
    renderEditor({ preset: "craie", text: "#f7f6f2", accent: "#f7f6f2" });
    expect(screen.getAllByRole("alert")).toHaveLength(2);
    // Replacing the text alone cannot make the accent readable, nor the reverse.
    expect(screen.queryAllByRole("button", { name: /Utiliser une couleur lisible/ })).toHaveLength(0);
  });

  test("EDI-030 when all checks pass: Lisible with both ratios", () => {
    renderEditor();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status").textContent).toMatch(
      /^Lisible\u00a0: contraste du texte \d+,\d:1, des boutons \d+,\d:1\.$/,
    );
  });

  test("TPL-018 the checks follow the edits", () => {
    renderEditor();
    fireEvent.change(screen.getByTestId("theme-text"), { target: { value: "#fefefe" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Texte illisible sur ce fond.");
    fireEvent.change(screen.getByTestId("theme-text"), { target: { value: "#000000" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("TPL-010 a colour is a swatch and a hex field; a partial hex is not applied", () => {
    const onChange = renderEditor();
    expect(screen.getByRole("button", { name: "Choisir la couleur d’accent" })).toBeVisible();
    const hex = screen.getByLabelText("Couleur d’accent");
    expect(hex).toHaveValue("#2f55d4");
    fireEvent.change(hex, { target: { value: "#ff00" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(hex).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(hex, { target: { value: "#FF0066" } });
    expect(lastTheme(onChange)).toMatchObject({ accent: "#ff0066" });
    fireEvent.blur(hex);
    expect(hex).toHaveValue("#ff0066");
  });

  test("TPL-009 the eight themes are thumbnails of a radio group; choosing one starts over from it", () => {
    const onChange = renderEditor({ preset: "craie", accent: "#ff0066", text: "#ffffff" });
    const group = screen.getByRole("radiogroup", { name: "Thèmes prêts à l’emploi" });
    expect(within(group).getAllByRole("radio")).toHaveLength(8);
    expect(within(group).getByRole("radio", { name: "Craie" })).toBeChecked();
    fireEvent.click(within(group).getByRole("radio", { name: "Encre" }));
    expect(onChange).toHaveBeenLastCalledWith({ preset: "encre" });
    expect(within(group).getByRole("radio", { name: "Encre" })).toBeChecked();
  });

  test("TPL-010 TPL-011 theme editor edits every override", async () => {
    const onChange = renderEditor();

    fireEvent.change(screen.getByTestId("theme-accent"), { target: { value: "#ff0066" } });
    expect(lastTheme(onChange)).toMatchObject({ preset: "craie", accent: "#ff0066" });

    fireEvent.change(screen.getByTestId("theme-text"), { target: { value: "#222222" } });
    expect(lastTheme(onChange)).toMatchObject({ text: "#222222" });

    fireEvent.change(screen.getByTestId("theme-background-color"), { target: { value: "#eeeeee" } });
    expect(lastTheme(onChange)).toMatchObject({ background: { kind: "solid", color: "#eeeeee" } });

    fireEvent.click(screen.getByRole("radio", { name: "Dégradé" }));
    expect(lastTheme(onChange).background).toMatchObject({ kind: "gradient", from: "#eeeeee", angle: 135 });
    fireEvent.change(screen.getByTestId("theme-gradient-from"), { target: { value: "#010203" } });
    fireEvent.change(screen.getByTestId("theme-gradient-to"), { target: { value: "#040506" } });
    fireEvent.keyDown(screen.getByRole("slider", { name: "Angle du dégradé" }), { key: "ArrowRight" });
    expect(lastTheme(onChange).background).toEqual({ kind: "gradient", from: "#010203", to: "#040506", angle: 136 });
    expect(screen.getByText("136°")).toBeVisible();

    fireEvent.keyDown(screen.getByRole("slider", { name: "Intensité du dégradé de l’en-tête" }), { key: "ArrowRight" });
    expect(lastTheme(onChange)).toMatchObject({ header_gradient: 46 });

    fireEvent.click(screen.getByRole("radio", { name: "Pilule" }));
    expect(lastTheme(onChange)).toMatchObject({ button_shape: "pill" });

    await chooseOption(screen.getByLabelText("Paire de polices"), "Éditoriale · Playfair Display + Source Sans 3");
    expect(lastTheme(onChange)).toMatchObject({ font: "playfair" });

    fireEvent.click(screen.getByRole("radio", { name: "Uni" }));
    expect(lastTheme(onChange).background).toEqual({ kind: "solid", color: "#010203" });
  });

  test("EDI-007 a read-only editor disables the Radix sliders too, which the fieldset does not reach", () => {
    renderEditor({ preset: "craie" }, true);
    expect(screen.getByRole("slider", { name: "Intensité du dégradé de l’en-tête" })).toHaveAttribute("data-disabled");
    expect(screen.getByRole("radio", { name: "Pilule" })).toBeDisabled();
  });
});
