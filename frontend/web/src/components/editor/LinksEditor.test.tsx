import { fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, test } from "vitest";
import type { DraftLink } from "@/lib/cards/draft";
import { LinksEditor } from "./LinksEditor";
import { chooseOption, renderWithIntl } from "./test-helpers";

function Harness({ initial, errors = {} }: { initial: DraftLink[]; errors?: Record<string, string> }) {
  const [links, setLinks] = useState(initial);
  return (
    <>
      <LinksEditor value={links} errors={errors} onChange={(next) => setLinks(next)} />
      <output data-testid="state">{JSON.stringify(links)}</output>
    </>
  );
}

const links = (): DraftLink[] => [
  { kind: "website", url: "https://a.example", label: "" },
  { kind: "custom", url: "https://b.example", label: "Mon podcast ✨" },
];

const state = () => JSON.parse(screen.getByTestId("state").textContent!) as DraftLink[];

describe("LinksEditor", () => {
  test("PUB-012 adds, edits and removes a link", async () => {
    renderWithIntl(<Harness initial={[]} />);
    expect(screen.getByText("Aucun lien pour l'instant.")).toBeVisible();
    fireEvent.click(screen.getByTestId("link-add"));
    fireEvent.change(screen.getByTestId("link-url-0"), { target: { value: "https://x.example" } });
    fireEvent.change(screen.getByTestId("link-label-0"), { target: { value: "Éloïse ✨" } });
    await chooseOption(screen.getByTestId("link-kind-0"), "LinkedIn");
    expect(state()).toEqual([{ kind: "linkedin", url: "https://x.example", label: "Éloïse ✨" }]);
    fireEvent.click(screen.getByTestId("link-remove-0"));
    expect(state()).toEqual([]);
  });

  test("PUB-022 links keep the order the owner chooses", () => {
    renderWithIntl(<Harness initial={links()} />);
    expect(screen.getByTestId("link-up-0")).toBeDisabled();
    expect(screen.getByTestId("link-down-1")).toBeDisabled();
    fireEvent.click(screen.getByTestId("link-down-0"));
    expect(state().map((link) => link.url)).toEqual(["https://b.example", "https://a.example"]);
    fireEvent.click(screen.getByTestId("link-up-1"));
    expect(state().map((link) => link.url)).toEqual(["https://a.example", "https://b.example"]);
  });

  test("PUB-022 no more than 20 links", () => {
    renderWithIntl(
      <Harness initial={Array.from({ length: 20 }, () => ({ kind: "website" as const, url: "https://a.example", label: "" }))} />,
    );
    expect(screen.getByTestId("link-add")).toBeDisabled();
  });

  test("EDI-015 a refused link shows its message next to the field", () => {
    renderWithIntl(
      <Harness
        initial={links()}
        errors={{ "links[1].url": "Cette adresse n'est pas valide.", "links[0].label": "Obligatoire." }}
      />,
    );
    const url = screen.getByTestId("link-url-1");
    expect(url).toHaveAttribute("aria-invalid", "true");
    expect(url).toHaveAccessibleDescription("Cette adresse n'est pas valide.");
    expect(screen.getByTestId("link-label-0")).toHaveAccessibleDescription("Obligatoire.");
    expect(screen.getByTestId("link-url-0")).not.toHaveAttribute("aria-invalid");
  });
});
