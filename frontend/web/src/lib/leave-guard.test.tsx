import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { useLeaveGuard } from "./leave-guard";

function Page({ dirty }: { dirty: boolean }) {
  useLeaveGuard(dirty, "Quitter la page ?");
  return (
    <div>
      <a href="/account" data-testid="internal">
        <span data-testid="inside">Mon compte</span>
      </a>
      <a href="https://example.test/" data-testid="external">
        Dehors
      </a>
      <a href="/new-tab" target="_blank" data-testid="blank">
        Autre onglet
      </a>
      <a href={window.location.pathname + "#section"} data-testid="same-page">
        Même page
      </a>
      <button type="button" data-testid="button">
        Bouton
      </button>
    </div>
  );
}

/** Clicks and tells whether the click reached the page undisturbed (the navigation itself is stopped). */
function goes(testId: string): boolean {
  let allowed = false;
  const stop = (event: Event) => {
    allowed = !event.defaultPrevented;
    event.preventDefault();
  };
  document.addEventListener("click", stop);
  fireEvent.click(screen.getByTestId(testId));
  document.removeEventListener("click", stop);
  return allowed;
}

afterEach(() => vi.restoreAllMocks());

describe("useLeaveGuard", () => {
  test("EDI-016 EDI-021 a clean page lets every link go without asking", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Page dirty={false} />);
    expect(goes("internal")).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  test("EDI-016 EDI-021 a dirty page asks for an internal link, even for a click on its content, and obeys the answer", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Page dirty />);
    expect(goes("inside")).toBe(false);
    expect(confirm).toHaveBeenCalledWith("Quitter la page ?");
    confirm.mockReturnValue(true);
    expect(goes("internal")).toBe(true);
  });

  test("EDI-016 EDI-021 only a link that leaves this page asks", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Page dirty />);
    expect(goes("external")).toBe(true);
    expect(goes("blank")).toBe(true);
    expect(goes("same-page")).toBe(true);
    expect(goes("button")).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  test("EDI-016 EDI-021 the guard goes away with the unsaved changes", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { rerender } = render(<Page dirty />);
    rerender(<Page dirty={false} />);
    expect(goes("internal")).toBe(true);
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
  });
});
