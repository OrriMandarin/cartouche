import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { SettingsSchema } from "@/templates/settings-schema";
import { SettingsForm } from "./SettingsForm";
import { chooseOption, renderWithIntl } from "./test-helpers";

// A template that does not exist: the form must be built from the schema alone.
const schema: SettingsSchema = {
  fields: [
    {
      kind: "select",
      key: "layout",
      labelKey: "fake.layout",
      options: [
        { value: "wide", labelKey: "fake.wide" },
        { value: "tall", labelKey: "fake.tall" },
        { value: "dense", labelKey: "fake.dense" },
      ],
      default: "wide",
    },
    {
      kind: "select",
      key: "shape",
      labelKey: "fake.shape",
      options: [
        { value: "round", labelKey: "fake.round" },
        { value: "square", labelKey: "fake.square" },
        { value: "oval", labelKey: "fake.oval" },
        { value: "star", labelKey: "fake.star" },
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
    layout: "Disposition",
    wide: "Large",
    tall: "Haute",
    dense: "Dense",
    shape: "Forme",
    round: "Ronde",
    square: "Carrée",
    oval: "Ovale",
    star: "Étoile",
    glow: "Lueur",
    size: "Taille",
    tint: "Teinte",
  },
};

function renderForm(onChange = vi.fn(), props: { disabled?: boolean; templateName?: string } = {}) {
  renderWithIntl(
    <SettingsForm
      schema={schema}
      value={{ layout: "wide", shape: "round", glow: false, size: 20, tint: "#112233" }}
      onChange={onChange}
      {...props}
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

  test("TPL-004 TPL-027 a select of at most three options is a segmented control, a longer one a select", () => {
    renderForm();
    const layout = screen.getByRole("radiogroup", { name: "Disposition" });
    expect(within(layout).getAllByRole("radio").map((radio) => radio.textContent)).toEqual(["Large", "Haute", "Dense"]);
    expect(within(layout).getByRole("radio", { name: "Large" })).toBeChecked();
    expect(screen.queryByRole("radiogroup", { name: "Forme" })).toBeNull();
  });

  test("TPL-004 the label of a setting names the template it belongs to", () => {
    renderForm(vi.fn(), { templateName: "Classique" });
    expect(screen.getByRole("radiogroup", { name: "Disposition · réglage du template Classique" })).toBeVisible();
  });

  test("EDI-007 a read-only form disables the Radix sliders and the segmented controls", () => {
    renderForm(vi.fn(), { disabled: true });
    expect(screen.getByRole("slider", { name: "Taille" })).toHaveAttribute("data-disabled");
    expect(screen.getByRole("radio", { name: "Haute" })).toBeDisabled();
  });

  test("TPL-004 EDI-007 each control emits its key and the new value", async () => {
    const onChange = renderForm();

    await chooseOption(screen.getByRole("combobox", { name: "Forme" }), "Carrée");
    expect(onChange).toHaveBeenLastCalledWith("shape", "square");

    fireEvent.click(screen.getByRole("radio", { name: "Haute" }));
    expect(onChange).toHaveBeenLastCalledWith("layout", "tall");

    fireEvent.click(screen.getByRole("switch", { name: "Lueur" }));
    expect(onChange).toHaveBeenLastCalledWith("glow", true);

    fireEvent.keyDown(screen.getByRole("slider", { name: "Taille" }), { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("size", 25);

    fireEvent.change(screen.getByLabelText("Teinte"), { target: { value: "#ff8800" } });
    expect(onChange).toHaveBeenLastCalledWith("tint", "#ff8800");
  });
});
