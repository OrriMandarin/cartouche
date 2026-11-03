import { fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, test, vi } from "vitest";
import type { ThemeSettings } from "@/lib/theme/presets";
import { ThemeEditor } from "./ThemeEditor";
import { chooseOption, renderWithIntl } from "./test-helpers";

function Harness({ initial, onChange }: { initial: ThemeSettings; onChange: (theme: ThemeSettings) => void }) {
  const [theme, setTheme] = useState(initial);
  return (
    <ThemeEditor
      theme={theme}
      onChange={(next) => {
        setTheme(next);
        onChange(next);
      }}
    />
  );
}

function renderEditor(initial: ThemeSettings = { preset: "craie" }) {
  const onChange = vi.fn<(theme: ThemeSettings) => void>();
  renderWithIntl(<Harness initial={initial} onChange={onChange} />);
  return onChange;
}

const lastTheme = (onChange: ReturnType<typeof renderEditor>) => onChange.mock.lastCall![0];

describe("ThemeEditor", () => {
  test("TPL-013 TPL-018 theme editor warns on low contrast", () => {
    renderEditor({ preset: "craie", text: "#ffffff" });
    expect(screen.getByTestId("contrast-warning")).toBeVisible();
  });

  test("TPL-018 no warning for a readable theme, and the warning follows the edits", () => {
    renderEditor();
    expect(screen.queryByTestId("contrast-warning")).toBeNull();
    fireEvent.change(screen.getByTestId("theme-text"), { target: { value: "#fefefe" } });
    expect(screen.getByTestId("contrast-warning")).toBeVisible();
    fireEvent.change(screen.getByTestId("theme-text"), { target: { value: "#000000" } });
    expect(screen.queryByTestId("contrast-warning")).toBeNull();
  });

  test("TPL-010 TPL-011 theme editor edits every override", async () => {
    const onChange = renderEditor();

    fireEvent.change(screen.getByTestId("theme-accent"), { target: { value: "#ff0066" } });
    expect(lastTheme(onChange)).toMatchObject({ preset: "craie", accent: "#ff0066" });

    fireEvent.change(screen.getByTestId("theme-text"), { target: { value: "#222222" } });
    expect(lastTheme(onChange)).toMatchObject({ text: "#222222" });

    fireEvent.change(screen.getByTestId("theme-background-color"), { target: { value: "#eeeeee" } });
    expect(lastTheme(onChange)).toMatchObject({ background: { kind: "solid", color: "#eeeeee" } });

    await chooseOption(screen.getByTestId("theme-background-kind"), "Dégradé");
    expect(lastTheme(onChange).background).toMatchObject({ kind: "gradient", from: "#eeeeee", angle: 135 });
    fireEvent.change(screen.getByTestId("theme-gradient-from"), { target: { value: "#010203" } });
    fireEvent.change(screen.getByTestId("theme-gradient-to"), { target: { value: "#040506" } });
    fireEvent.keyDown(screen.getByRole("slider", { name: "Angle du dégradé" }), { key: "ArrowRight" });
    expect(lastTheme(onChange).background).toEqual({ kind: "gradient", from: "#010203", to: "#040506", angle: 136 });

    fireEvent.keyDown(screen.getByRole("slider", { name: "Intensité du dégradé de l'en-tête" }), { key: "ArrowRight" });
    expect(lastTheme(onChange)).toMatchObject({ header_gradient: 46 });

    await chooseOption(screen.getByTestId("theme-button-shape"), "Pilule");
    expect(lastTheme(onChange)).toMatchObject({ button_shape: "pill" });

    await chooseOption(screen.getByTestId("theme-font"), "Éditoriale");
    expect(lastTheme(onChange)).toMatchObject({ font: "playfair" });

    await chooseOption(screen.getByTestId("theme-background-kind"), "Couleur unie");
    expect(lastTheme(onChange).background).toEqual({ kind: "solid", color: "#010203" });
  });

  test("TPL-009 choosing a preset starts over from that preset", async () => {
    const onChange = renderEditor({ preset: "craie", accent: "#ff0066", text: "#ffffff" });
    await chooseOption(screen.getByTestId("theme-preset"), "Encre");
    expect(onChange).toHaveBeenLastCalledWith({ preset: "encre" });
    expect(screen.getByTestId("theme-preset")).toHaveTextContent("Encre");
  });
});
