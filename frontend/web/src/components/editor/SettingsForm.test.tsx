import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { SettingsSchema } from "@/templates/settings-schema";
import { SettingsForm } from "./SettingsForm";
import { chooseOption, renderWithIntl } from "./test-helpers";

// A template that does not exist: the form must be built from the schema alone.
const schema: SettingsSchema = {
  fields: [
    {
      kind: "select",
      key: "shape",
      labelKey: "fake.shape",
      options: [
        { value: "round", labelKey: "fake.round" },
        { value: "square", labelKey: "fake.square" },
      ],
      default: "round",
    },
    { kind: "boolean", key: "glow", labelKey: "fake.glow", default: false },
    { kind: "range", key: "size", labelKey: "fake.size", min: 10, max: 50, step: 5, default: 20 },
    { kind: "color", key: "tint", labelKey: "fake.tint", default: "#112233" },
  ],
};

const fakeMessages = {
  fake: {
    shape: "Forme",
    round: "Ronde",
    square: "Carrée",
    glow: "Lueur",
    size: "Taille",
    tint: "Teinte",
  },
};

function renderForm(onChange = vi.fn()) {
  renderWithIntl(
    <SettingsForm
      schema={schema}
      value={{ shape: "round", glow: false, size: 20, tint: "#112233" }}
      onChange={onChange}
    />,
    fakeMessages,
  );
  return onChange;
}

describe("SettingsForm", () => {
  test("TPL-004 EDI-007 settings form is generated from any schema: one control per kind, labelled", () => {
    renderForm();
    expect(screen.getByRole("combobox", { name: "Forme" })).toHaveTextContent("Ronde");
    expect(screen.getByRole("switch", { name: "Lueur" })).not.toBeChecked();
    expect(screen.getByRole("slider", { name: "Taille" })).toHaveAttribute("aria-valuenow", "20");
    expect(screen.getByLabelText("Teinte")).toHaveAttribute("type", "color");
    expect(screen.getByLabelText("Teinte")).toHaveValue("#112233");
  });

  test("TPL-004 EDI-007 each control emits its key and the new value", async () => {
    const onChange = renderForm();

    await chooseOption(screen.getByRole("combobox", { name: "Forme" }), "Carrée");
    expect(onChange).toHaveBeenLastCalledWith("shape", "square");

    fireEvent.click(screen.getByRole("switch", { name: "Lueur" }));
    expect(onChange).toHaveBeenLastCalledWith("glow", true);

    fireEvent.keyDown(screen.getByRole("slider", { name: "Taille" }), { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("size", 25);

    fireEvent.change(screen.getByLabelText("Teinte"), { target: { value: "#ff8800" } });
    expect(onChange).toHaveBeenLastCalledWith("tint", "#ff8800");
  });
});
