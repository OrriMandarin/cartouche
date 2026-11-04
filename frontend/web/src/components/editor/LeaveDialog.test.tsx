import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { LeaveGuard } from "@/lib/leave-guard";
import { LeaveDialog } from "./LeaveDialog";
import { renderWithIntl } from "./test-helpers";

const guard = (overrides: Partial<LeaveGuard> = {}): LeaveGuard => ({
  asking: true,
  saving: false,
  stay: vi.fn(),
  leave: vi.fn(),
  saveAndLeave: vi.fn(async () => undefined),
  ...overrides,
});

describe("LeaveDialog", () => {
  test("EDI-028 offers the three choices, Rester focused first", () => {
    const g = guard();
    renderWithIntl(<LeaveDialog guard={g} description="Tu as modifié l’événement." />);
    expect(screen.getByRole("alertdialog", { name: "Quitter sans enregistrer ?" })).toBeInTheDocument();
    expect(screen.getByText("Tu as modifié l’événement.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rester" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Quitter sans enregistrer" }));
    expect(g.leave).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer et quitter" }));
    expect(g.saveAndLeave).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Rester" }));
    expect(g.stay).toHaveBeenCalled();
  });

  test("EDI-028 nothing is shown while no navigation is held back", () => {
    renderWithIntl(<LeaveDialog guard={guard({ asking: false })} description="x" />);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  test("EDI-028 Enregistrer et quitter waits while the draft cannot be saved, and says why", () => {
    renderWithIntl(<LeaveDialog guard={guard()} description="x" canSave={false} />);
    expect(screen.getByRole("button", { name: "Enregistrer et quitter" })).toBeDisabled();
    expect(screen.getByTestId("leave-cannot-save")).toBeInTheDocument();
  });
});
