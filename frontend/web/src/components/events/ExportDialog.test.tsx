import { ApiError } from "@cartouche/api-client";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { renderWithIntl } from "@/components/editor/test-helpers";

const download = vi.fn();
vi.mock("@/lib/api", () => ({ useDownloadExport: () => download }));
vi.mock("@/lib/events/time", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/time")>()),
  userTimeZone: () => "Europe/Paris",
}));

import { ExportDialog } from "./ExportDialog";

beforeEach(() => {
  download.mockReset();
  download.mockResolvedValue("contacts.csv");
});

function open(scope: Parameters<typeof ExportDialog>[0]["scope"] = { kind: "event", id: "event-1" }) {
  renderWithIntl(<ExportDialog scope={scope} />);
  fireEvent.click(screen.getByTestId("export-open"));
}

describe("ExportDialog", () => {
  test("LEA-021 the dialog offers the three formats, CSV chosen, spam left out, and a hint for Excel users", async () => {
    open();
    expect(await screen.findByRole("dialog")).toBeVisible();
    expect(screen.getByTestId("export-format-csv")).toBeChecked();
    expect(screen.getByLabelText(/^CSV/)).toBe(screen.getByTestId("export-format-csv"));
    expect(screen.getByLabelText(/^XLSX/)).toBe(screen.getByTestId("export-format-xlsx"));
    expect(screen.getByLabelText(/^JSON/)).toBe(screen.getByTestId("export-format-json"));
    expect(screen.getByTestId("export-include-spam")).not.toBeChecked();
    expect(screen.getByLabelText("Inclure les contacts marqués comme spam")).toBe(screen.getByTestId("export-include-spam"));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Excel, Numbers, Google Sheets");
    expect(dialog).toHaveTextContent("Fichier Excel");
    expect(dialog).toHaveTextContent("Pour un outil ou un script");
    expect(dialog.textContent).toContain(
      "Une ligne par contact\u00a0; une colonne par champ, champs personnalisés et consentement compris.",
    );
  });

  test("LEA-021 LEA-012 the export of an event downloads the CSV with spam left out, in the user's time zone", async () => {
    open({ kind: "event", id: "event-1" });
    fireEvent.click(await screen.findByTestId("export-download"));
    await waitFor(() => expect(download).toHaveBeenCalledWith("/api/events/event-1/leads/export?format=csv&include_spam=false&tz=Europe%2FParis"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  test("LEA-021 LEA-012 the chosen format and the spam option go to the whole-card export", async () => {
    open({ kind: "card", id: "card-1" });
    fireEvent.click(await screen.findByTestId("export-format-xlsx"));
    fireEvent.click(screen.getByTestId("export-include-spam"));
    fireEvent.click(screen.getByTestId("export-download"));
    await waitFor(() => expect(download).toHaveBeenCalledWith("/api/cards/card-1/leads/export?format=xlsx&include_spam=true&tz=Europe%2FParis"));
  });

  test("LEA-021 the download button is disabled while the file is being fetched", async () => {
    let finish: (name: string) => void = () => undefined;
    download.mockReturnValue(new Promise<string>((resolve) => (finish = resolve)));
    open();
    fireEvent.click(await screen.findByTestId("export-download"));
    await waitFor(() => expect(screen.getByTestId("export-download")).toBeDisabled());
    expect(download).toHaveBeenCalledTimes(1);
    finish("contacts.csv");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  test("LEA-021 a failed export shows the error and keeps the dialog open", async () => {
    download.mockRejectedValue(new ApiError({ status: 500, code: "internal_error", message: "Boom.", requestId: "req-9" }));
    open();
    fireEvent.click(await screen.findByTestId("export-download"));
    expect(await screen.findByTestId("error-request-id")).toHaveTextContent("req-9");
    expect(screen.getByRole("dialog")).toBeVisible();
    await waitFor(() => expect(screen.getByTestId("export-download")).toBeEnabled());

    download.mockResolvedValue("contacts.csv");
    fireEvent.click(screen.getByTestId("export-download"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  test("LEA-035 the dialog names its scope and the button gives the exact count, spam left out until it is included", async () => {
    renderWithIntl(
      <ExportDialog
        scope={{ kind: "event", id: "event-1" }}
        summary={{ cardSlug: "camille-roche", eventTitle: "Salon du Mariage Clermont 2027", counts: { total: 38, spam: 1 } }}
      />,
    );
    fireEvent.click(screen.getByTestId("export-open"));
    expect(await screen.findByTestId("export-scope")).toHaveTextContent(
      "Carte camille-roche · Salon du Mariage Clermont 2027 · 38 contacts",
    );
    expect(screen.getByTestId("export-download")).toHaveTextContent("Exporter 37 contacts");
    expect(screen.getByLabelText("Inclure les contacts marqués comme spam (1)")).toBe(screen.getByTestId("export-include-spam"));

    fireEvent.click(screen.getByTestId("export-include-spam"));
    expect(screen.getByTestId("export-download")).toHaveTextContent("Exporter 38 contacts");
    fireEvent.click(screen.getByTestId("export-include-spam"));
    expect(screen.getByTestId("export-download")).toHaveTextContent("Exporter 37 contacts");
  });

  test("LEA-035 the whole card is named as such, and a single contact reads in the singular", async () => {
    renderWithIntl(
      <ExportDialog
        scope={{ kind: "card", id: "card-1" }}
        summary={{ cardSlug: "alice-durand", eventTitle: null, counts: { total: 2, spam: 1 } }}
      />,
    );
    fireEvent.click(screen.getByTestId("export-open"));
    expect(await screen.findByTestId("export-scope")).toHaveTextContent("Carte alice-durand · Toute la carte · 2 contacts");
    expect(screen.getByTestId("export-download")).toHaveTextContent("Exporter 1 contact");
    expect(screen.getByTestId("export-download")).not.toHaveTextContent("contacts");
  });

  test("LEA-035 LEA-031 with nothing but spam to export the button says 0 and still exports the header row", async () => {
    renderWithIntl(
      <ExportDialog
        scope={{ kind: "event", id: "event-1" }}
        summary={{ cardSlug: "alice-durand", eventTitle: "Salon", counts: { total: 2, spam: 2 } }}
      />,
    );
    fireEvent.click(screen.getByTestId("export-open"));
    expect(await screen.findByTestId("export-download")).toHaveTextContent("Exporter 0 contact");
    expect(screen.getByTestId("export-download")).toBeEnabled();
    fireEvent.click(screen.getByTestId("export-include-spam"));
    expect(screen.getByTestId("export-download")).toHaveTextContent("Exporter 2 contacts");
  });
});
