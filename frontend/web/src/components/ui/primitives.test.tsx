import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import AppLayout from "@/app/(app)/layout";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Toaster } from "@/components/ui/toaster";
import { showToast } from "@/lib/toast";

vi.mock("@/lib/auth/AuthProvider", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe("dashboard primitives", () => {
  test("TPL-026 the dashboard has no card variable", () => {
    const { container } = render(
      <AppLayout>
        <p>content</p>
      </AppLayout>,
    );
    const elements = [container, ...container.querySelectorAll("*")] as HTMLElement[];
    for (const element of elements) {
      expect(element.getAttribute("style") ?? "").not.toContain("--c-");
    }
    expect(container.firstElementChild).toHaveClass("font-app", "bg-app-bg", "text-app-text", "min-h-screen");
  });

  test("EDI-011 the AlertDialog focuses its default action (the safe one)", () => {
    const onAction = vi.fn();
    render(
      <AlertDialog open>
        <AlertDialogContent>
          <AlertDialogTitle>Delete?</AlertDialogTitle>
          <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onAction}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>,
    );
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(onAction).not.toHaveBeenCalled();
  });

  test("EDI-011 the AlertDialog closes on Escape", () => {
    const onOpenChange = vi.fn();
    render(
      <AlertDialog open onOpenChange={onOpenChange}>
        <AlertDialogContent>
          <AlertDialogTitle>Delete?</AlertDialogTitle>
          <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
        </AlertDialogContent>
      </AlertDialog>,
    );
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test("EDI-011 toast shows its action and calls it", async () => {
    const onUndo = vi.fn();
    render(<Toaster />);
    act(() => {
      showToast("Event deleted", { action: { label: "Undo", onClick: onUndo } });
    });
    expect(await screen.findByText("Event deleted")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onUndo).toHaveBeenCalledOnce();
  });
});
