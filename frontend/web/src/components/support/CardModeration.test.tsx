import { fireEvent, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@cartouche/api-client";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { cardView } from "@/components/cards/card-view.fixture";
import { renderWithIntl } from "@/components/editor/test-helpers";
import { CardModeration } from "./CardModeration";

const post = vi.fn();
vi.mock("@/lib/api", () => ({ useApi: () => ({ POST: post }) }));

beforeEach(() => {
  post.mockReset();
});

describe("CardModeration", () => {
  test("ADM-009 an active card offers « Désactiver (support) », which calls support-disable then reloads", async () => {
    post.mockResolvedValue({ data: {} });
    const onChanged = vi.fn().mockResolvedValue(undefined);
    renderWithIntl(<CardModeration card={cardView({ id: "card-9" })} onChanged={onChanged} />);

    expect(screen.queryByTestId("support-card-enable")).toBeNull();
    const button = screen.getByTestId("support-card-disable");
    expect(button).toHaveTextContent("Désactiver (support)");
    fireEvent.click(button);

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith("/api/admin/cards/{id}/support-disable", {
      params: { path: { id: "card-9" } },
    });
  });

  test("ADM-009 ADM-010 a card disabled by its owner can still be blocked by the support", () => {
    renderWithIntl(<CardModeration card={cardView({ status: "disabled" })} onChanged={vi.fn()} />);
    expect(screen.getByTestId("support-card-disable")).toBeEnabled();
  });

  test("ADM-010 a blocked card offers « Lever le blocage », which calls support-enable then reloads", async () => {
    post.mockResolvedValue({ data: {} });
    const onChanged = vi.fn().mockResolvedValue(undefined);
    renderWithIntl(
      <CardModeration card={cardView({ id: "card-3", status: "disabled_by_support" })} onChanged={onChanged} />,
    );

    expect(screen.queryByTestId("support-card-disable")).toBeNull();
    const button = screen.getByTestId("support-card-enable");
    expect(button).toHaveTextContent("Lever le blocage");
    fireEvent.click(button);

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith("/api/admin/cards/{id}/support-enable", {
      params: { path: { id: "card-3" } },
    });
  });

  test("ADM-009 ADM-010 the button stays disabled from the click until the reload has finished", async () => {
    post.mockResolvedValue({ data: {} });
    let finishReload: () => void = () => undefined;
    const onChanged = vi.fn(() => new Promise<void>((resolve) => (finishReload = resolve)));
    renderWithIntl(<CardModeration card={cardView()} onChanged={onChanged} />);

    fireEvent.click(screen.getByTestId("support-card-disable"));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("support-card-disable")).toBeDisabled();

    finishReload();
    await waitFor(() => expect(screen.getByTestId("support-card-disable")).toBeEnabled());
  });

  test("ADM-015 a refused action shows the notice with the request id and does not reload", async () => {
    post.mockRejectedValue(
      new ApiError({ status: 409, code: "invalid_transition", message: "no", requestId: "req-409" }),
    );
    const onChanged = vi.fn();
    renderWithIntl(<CardModeration card={cardView()} onChanged={onChanged} />);

    fireEvent.click(screen.getByTestId("support-card-disable"));
    expect(await screen.findByTestId("error-request-id")).toHaveTextContent("req-409");
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getByTestId("support-card-disable")).toBeEnabled();
  });
});
