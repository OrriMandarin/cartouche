import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { cardView } from "@/components/cards/card-view.fixture";
import { draftFromCard } from "@/lib/cards/draft";
import { PhonePreview } from "./PhonePreview";
import { renderWithIntl } from "./test-helpers";

const draft = draftFromCard(
  cardView({
    content: { first_name: "Éloïse", job_title: "Cheffe de projet" },
    links: [{ kind: "website", url: "https://eloise.example", label: null }],
  }),
);

describe("PhonePreview", () => {
  test("TPL-014 EDI-004 renders the draft with the template in preview mode", () => {
    renderWithIntl(<PhonePreview draft={draft} simulateEvent={false} publicBaseUrl="http://localhost:13000" />);
    expect(screen.getByTestId("phone-preview").querySelector("article")).toHaveAttribute("data-mode", "preview");
    expect(screen.getByTestId("card-name")).toHaveTextContent("Éloïse");
    expect(screen.getByTestId("card-job-title")).toHaveTextContent("Cheffe de projet");
    expect(screen.getByTestId("card-link-0")).toHaveAccessibleName("Site web — eloise.example");
    expect(screen.getByTestId("save-contact")).toHaveAttribute("href", "/api/public/cards/alice-durand/vcard");
  });

  test("EDI-005 the simulated event appears only when asked", () => {
    const { unmount } = renderWithIntl(
      <PhonePreview draft={draft} simulateEvent={false} publicBaseUrl="http://localhost:13000" />,
    );
    expect(screen.queryByTestId("event-button-preview")).toBeNull();
    unmount();
    renderWithIntl(<PhonePreview draft={draft} simulateEvent publicBaseUrl="http://localhost:13000" />);
    expect(screen.getByTestId("event-button-preview")).toHaveTextContent("Événement de démonstration");
  });

  test("EDI-004 the preview never navigates: a click on any link is cancelled", () => {
    renderWithIntl(<PhonePreview draft={draft} simulateEvent publicBaseUrl="http://localhost:13000" />);
    for (const id of ["card-link-0", "event-button-preview", "save-contact"]) {
      expect(fireEvent.click(screen.getByTestId(id))).toBe(false);
    }
  });
});
