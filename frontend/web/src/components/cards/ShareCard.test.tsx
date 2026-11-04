import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, test, vi } from "vitest";
import messages from "../../../messages/fr.json";
import { cardView } from "./card-view.fixture";

const saveBlob = vi.fn();
vi.mock("@/lib/cards/qr", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/cards/qr")>()),
  saveBlob: (...args: unknown[]) => saveBlob(...args),
}));
const showToast = vi.fn();
vi.mock("@/lib/toast", () => ({ showToast: (...args: unknown[]) => showToast(...args) }));

import { CopyLinkButton, downloadQr } from "./ShareCard";

const card = cardView({ slug: "alice-durand", public_url: "https://cartouche.test/c/alice-durand" });

function renderCopy(copy: (text: string) => Promise<void>) {
  render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <CopyLinkButton card={card} copy={copy} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  saveBlob.mockReset();
  showToast.mockReset();
});

describe("ShareCard", () => {
  test("EDI-023 LNK-017 copying the link confirms Lien copié", async () => {
    const copy = vi.fn().mockResolvedValue(undefined);
    renderCopy(copy);
    fireEvent.click(screen.getByRole("button", { name: "Copier le lien de alice-durand" }));
    await waitFor(() => expect(copy).toHaveBeenCalledWith("https://cartouche.test/c/alice-durand"));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("Lien copié\u00a0: https://cartouche.test/c/alice-durand"));
  });

  test("LNK-017 says so when the link cannot be copied", async () => {
    renderCopy(vi.fn().mockRejectedValue(new Error("denied")));
    fireEvent.click(screen.getByTestId("card-copy-alice-durand"));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("Impossible de copier le lien"));
  });

  test("LNK-017 LNK-029 downloads the QR codes as <slug>.svg and <slug>.png", async () => {
    await downloadQr(card, "svg", "failed");
    const [svg, svgName] = saveBlob.mock.calls[0] as [Blob, string];
    expect(svgName).toBe("alice-durand.svg");
    expect(svg.type).toBe("image/svg+xml");
    expect(await svg.text()).toContain("<svg");

    await downloadQr(card, "png", "failed");
    const [png, pngName] = saveBlob.mock.calls[1] as [Blob, string];
    expect(pngName).toBe("alice-durand.png");
    expect(png.type).toBe("image/png");
    expect(showToast).not.toHaveBeenCalled();
  });
});
