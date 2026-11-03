import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import messages from "../../../messages/fr.json";
import { cardView } from "./card-view.fixture";
import { ShareCard } from "./ShareCard";

const saveBlob = vi.fn();
vi.mock("@/lib/cards/qr", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/cards/qr")>()),
  saveBlob: (...args: unknown[]) => saveBlob(...args),
}));

function renderShare() {
  render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <ShareCard card={cardView({ slug: "alice-durand", public_url: "https://cartouche.test/c/alice-durand" })} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  saveBlob.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ShareCard", () => {
  test("LNK-017 LNK-029 copies the public url of the card", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    renderShare();
    fireEvent.click(screen.getByTestId("card-copy-alice-durand"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("https://cartouche.test/c/alice-durand"));
    expect(await screen.findByText("Lien copié")).toBeInTheDocument();
  });

  test("LNK-017 says so when the link cannot be copied", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    renderShare();
    fireEvent.click(screen.getByTestId("card-copy-alice-durand"));
    expect(await screen.findByText("Impossible de copier le lien")).toBeInTheDocument();
  });

  test("LNK-017 LNK-029 downloads the QR codes as <slug>.svg and <slug>.png", async () => {
    renderShare();
    fireEvent.click(screen.getByTestId("card-qr-svg-alice-durand"));
    await waitFor(() => expect(saveBlob).toHaveBeenCalledTimes(1));
    const [svg, svgName] = saveBlob.mock.calls[0] as [Blob, string];
    expect(svgName).toBe("alice-durand.svg");
    expect(svg.type).toBe("image/svg+xml");
    expect(await svg.text()).toContain("<svg");

    fireEvent.click(screen.getByTestId("card-qr-png-alice-durand"));
    await waitFor(() => expect(saveBlob).toHaveBeenCalledTimes(2));
    const [png, pngName] = saveBlob.mock.calls[1] as [Blob, string];
    expect(pngName).toBe("alice-durand.png");
    expect(png.type).toBe("image/png");
  });
});
