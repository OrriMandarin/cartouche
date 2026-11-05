import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { useLeaveGuard } from "./leave-guard";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

function Page({ dirty, save = async () => true }: { dirty: boolean; save?: () => Promise<boolean> }) {
  const guard = useLeaveGuard({ dirty, save });
  return (
    <div>
      <a href="/account" data-testid="internal">
        <span data-testid="inside">Mon compte</span>
      </a>
      <a href="https://example.test/" data-testid="external">
        Dehors
      </a>
      <a href="/file.pdf" download data-testid="download">
        Télécharger
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
      <output data-testid="asked">{guard.asking ? "asking" : "quiet"}</output>
      <output data-testid="saving">{guard.saving ? "saving" : "idle"}</output>
      <button type="button" data-testid="stay" onClick={guard.stay} />
      <button type="button" data-testid="discard" onClick={guard.leave} />
      <button type="button" data-testid="save-leave" onClick={() => void guard.saveAndLeave()} />
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

const asking = () => screen.getByTestId("asked").textContent === "asking";

afterEach(() => {
  vi.restoreAllMocks();
  push.mockReset();
});

describe("useLeaveGuard", () => {
  test("EDI-028 without changes nothing is asked", () => {
    render(<Page dirty={false} />);
    expect(goes("internal")).toBe(true);
    expect(asking()).toBe(false);
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
  });

  test("EDI-028 leaving with changes opens the dialog, Rester stays", () => {
    render(<Page dirty />);
    expect(goes("inside")).toBe(false);
    expect(asking()).toBe(true);
    fireEvent.click(screen.getByTestId("stay"));
    expect(asking()).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });

  test("EDI-028 Quitter sans enregistrer goes to the link that was clicked", () => {
    render(<Page dirty />);
    goes("internal");
    fireEvent.click(screen.getByTestId("discard"));
    expect(push).toHaveBeenCalledWith("/account");
    expect(asking()).toBe(false);
  });

  test("EDI-028 Enregistrer et quitter leaves only after the save", async () => {
    let finish: (saved: boolean) => void = () => undefined;
    const save = vi.fn(() => new Promise<boolean>((resolve) => (finish = resolve)));
    render(<Page dirty save={save} />);
    goes("internal");
    fireEvent.click(screen.getByTestId("save-leave"));
    expect(save).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("saving").textContent).toBe("saving");
    expect(push).not.toHaveBeenCalled();
    await act(async () => finish(true));
    expect(push).toHaveBeenCalledWith("/account");
  });

  test("EDI-028 a refused save closes the dialog and stays", async () => {
    render(<Page dirty save={async () => false} />);
    goes("internal");
    fireEvent.click(screen.getByTestId("save-leave"));
    await waitFor(() => expect(asking()).toBe(false));
    expect(push).not.toHaveBeenCalled();
  });

  test("EDI-016 only a link that leaves this page asks", () => {
    render(<Page dirty />);
    expect(goes("external")).toBe(true);
    expect(goes("blank")).toBe(true);
    expect(goes("same-page")).toBe(true);
    expect(goes("button")).toBe(true);
    expect(asking()).toBe(false);
  });

  test("EDI-028 a download link and a modified click are left to the browser", () => {
    render(<Page dirty />);
    expect(goes("download")).toBe(true);
    for (const modifier of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      const click = new MouseEvent("click", { bubbles: true, cancelable: true, ...modifier });
      screen.getByTestId("internal").dispatchEvent(click);
      expect(click.defaultPrevented).toBe(false);
    }
    expect(asking()).toBe(false);
  });

  test("EDI-016 the browser asks before closing or reloading, until the changes are gone", () => {
    const { rerender } = render(<Page dirty />);
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    rerender(<Page dirty={false} />);
    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
  });
});
