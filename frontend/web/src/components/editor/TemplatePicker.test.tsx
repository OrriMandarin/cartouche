import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { classique } from "@/templates/classique";
import { TemplatePicker } from "./TemplatePicker";
import { renderWithIntl } from "./test-helpers";

const experimental = {
  ...classique,
  id: "experimental" as never,
  nameKey: "fake.experimental",
  beta: true,
};
const fakeMessages = { fake: { experimental: "Expérimental" } };

describe("TemplatePicker", () => {
  test("TPL-006 TPL-005 template picker shows beta badge only on a beta template", () => {
    renderWithIntl(
      <TemplatePicker value="classique" onChange={vi.fn()} templates={[classique, experimental]} />,
      fakeMessages,
    );
    expect(screen.getByTestId("template-option-classique")).toHaveTextContent("Classique");
    expect(screen.queryByTestId("template-beta-classique")).toBeNull();
    expect(screen.getByTestId("template-beta-experimental")).toHaveTextContent("bêta");
  });

  test("TPL-005 TPL-007 every template is offered and choosing one reports its id", () => {
    const onChange = vi.fn();
    renderWithIntl(
      <TemplatePicker value="classique" onChange={onChange} templates={[classique, experimental]} />,
      fakeMessages,
    );
    expect(screen.getByRole("radio", { name: /Classique/ })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: /Expérimental/ }));
    expect(onChange).toHaveBeenCalledWith("experimental");
  });

  test("TPL-015 an unknown template of the card shows as the fallback template", () => {
    renderWithIntl(<TemplatePicker value="retired" onChange={vi.fn()} />);
    expect(screen.getByRole("radio", { name: /Classique/ })).toBeChecked();
  });

  test("TPL-007 the default list holds the templates of the registry", () => {
    renderWithIntl(<TemplatePicker value="classique" onChange={vi.fn()} />);
    expect(screen.getAllByRole("radio")).toHaveLength(1);
  });
});
