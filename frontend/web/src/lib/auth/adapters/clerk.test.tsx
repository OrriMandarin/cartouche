import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { useAuth } from "../context";

const clerkSignOut = vi.fn();

vi.mock("@clerk/nextjs", () => ({
  ClerkProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => ({ isLoaded: true, isSignedIn: true, getToken: async () => "tok" }),
  useUser: () => ({ user: { id: "user_1", fullName: "Alice", primaryEmailAddress: { emailAddress: "a@example.test" } } }),
  useClerk: () => ({ signOut: clerkSignOut }),
}));

import { ClerkAuthAdapter } from "./clerk";

function setup() {
  let current: ReturnType<typeof useAuth> | undefined;
  function Probe() {
    current = useAuth();
    return <span data-testid="status">{current.status}</span>;
  }
  render(
    <ClerkAuthAdapter>
      <Probe />
    </ClerkAuthAdapter>,
  );
  return () => current!;
}

beforeEach(() => {
  clerkSignOut.mockReset();
});

describe("ClerkAuthAdapter signOut", () => {
  test("ACC-014: signOut without options keeps Clerk's default return address", async () => {
    const auth = setup();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signed-in"));
    await auth().signOut();
    expect(clerkSignOut).toHaveBeenCalledTimes(1);
    expect(clerkSignOut).toHaveBeenCalledWith();
  });

  test("ACC-023: signOut with redirectTo returns to that path", async () => {
    const auth = setup();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signed-in"));
    await auth().signOut({ redirectTo: "/account-deleted" });
    expect(clerkSignOut).toHaveBeenCalledWith({ redirectUrl: "/account-deleted" });
  });
});
