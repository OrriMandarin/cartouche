import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, test, vi } from "vitest";
import type { DraftLink } from "@/lib/cards/draft";
import { LinksEditor } from "./LinksEditor";
import { renderWithIntl } from "./test-helpers";

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
    expect(screen.getByText("Aucun lien pour l’instant.")).toBeVisible();
    fireEvent.click(screen.getByTestId("link-add"));
    fireEvent.change(screen.getByTestId("link-url-0"), { target: { value: "https://x.example" } });
    fireEvent.change(screen.getByTestId("link-label-0"), { target: { value: "Éloïse ✨" } });
    expect(state()).toEqual([{ kind: "custom", url: "https://x.example", label: "Éloïse ✨" }]);
    expect(screen.getByRole("button", { name: "Retirer Éloïse ✨" })).toBeVisible();
    fireEvent.click(screen.getByTestId("link-remove-0"));
    expect(state()).toEqual([]);
  });

  test("PUB-012 a network is added from the menu of the seven kinds", async () => {
    renderWithIntl(<Harness initial={[]} />);
    fireEvent.pointerDown(screen.getByTestId("link-add-network"), { button: 0, ctrlKey: false });
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Site web",
      "LinkedIn",
      "Instagram",
      "Facebook",
      "TikTok",
      "YouTube",
      "X",
    ]);
    fireEvent.click(screen.getByRole("menuitem", { name: "LinkedIn" }));
    expect(state()).toEqual([{ kind: "linkedin", url: "", label: "" }]);
    expect(screen.getByLabelText("LinkedIn")).toHaveAttribute("type", "url");
    expect(screen.getByRole("button", { name: "Déplacer LinkedIn" })).toBeVisible();
  });

  test("EDI-029 arrow keys move a link and announce its position", () => {
    renderWithIntl(<Harness initial={links()} />);
    const handle = screen.getByRole("button", { name: "Déplacer Site web" });
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    expect(state().map((link) => link.url)).toEqual(["https://b.example", "https://a.example"]);
    expect(screen.getByTestId("links-live")).toHaveTextContent("Site web, position 2 sur 2");
    expect(screen.getByTestId("links-live")).toHaveAttribute("aria-live", "polite");
    // The handle follows the link and keeps the focus.
    expect(screen.getByTestId("link-handle-1")).toHaveFocus();
    fireEvent.keyDown(screen.getByTestId("link-handle-1"), { key: "ArrowDown" });
    expect(state().map((link) => link.url)).toEqual(["https://b.example", "https://a.example"]);
    fireEvent.keyDown(screen.getByTestId("link-handle-1"), { key: "ArrowUp" });
    expect(state().map((link) => link.url)).toEqual(["https://a.example", "https://b.example"]);
    expect(screen.getByTestId("links-live")).toHaveTextContent("Site web, position 1 sur 2");
  });

  test("EDI-029 dragging reorders the links", async () => {
    // jsdom has no layout: each row is given a place, one under the other.
    const rect = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const row = this.closest("[data-testid^='link-row-']");
      const top = row ? Number(row.getAttribute("data-testid")!.replace("link-row-", "")) * 100 : 0;
      return { x: 0, y: top, top, left: 0, width: 300, height: 80, right: 300, bottom: top + 80, toJSON: () => ({}) };
    });
    renderWithIntl(<Harness initial={links()} />);
    const handle = screen.getByTestId("link-handle-0");
    handle.focus();
    // dnd-kit's own keyboard drag: Space picks up, an arrow moves over the next link, Space drops.
    const tick = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));
    fireEvent.keyDown(handle, { key: " ", code: "Space" });
    await tick();
    fireEvent.keyDown(document, { key: "ArrowDown", code: "ArrowDown" });
    await tick();
    fireEvent.keyDown(document, { key: " ", code: "Space" });
    await waitFor(() => expect(state().map((link) => link.url)).toEqual(["https://b.example", "https://a.example"]));
    rect.mockRestore();
  });

  test("PUB-022 no more than 20 links", () => {
    renderWithIntl(
      <Harness initial={Array.from({ length: 20 }, () => ({ kind: "website" as const, url: "https://a.example", label: "" }))} />,
    );
    expect(screen.getByTestId("link-add")).toBeDisabled();
    expect(screen.getByTestId("link-add-network")).toBeDisabled();
    expect(screen.getByText("Une carte a au plus 20 liens.")).toBeVisible();
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
