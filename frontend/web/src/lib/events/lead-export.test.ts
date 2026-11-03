import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ApiError } from "@cartouche/api-client";
import { downloadExport, exportPath, fileNameFromDisposition } from "./lead-export";

describe("exportPath", () => {
  test("LEA-021 LEA-026 export path carries format, spam option and zone", () => {
    expect(exportPath({ kind: "event", id: "ev-1" }, "csv", false, "Europe/Paris")).toBe(
      "/api/events/ev-1/leads/export?format=csv&include_spam=false&tz=Europe%2FParis",
    );
    expect(exportPath({ kind: "card", id: "card-1" }, "xlsx", true, "America/Port-au-Prince")).toBe(
      "/api/cards/card-1/leads/export?format=xlsx&include_spam=true&tz=America%2FPort-au-Prince",
    );
    expect(exportPath({ kind: "card", id: "card-1" }, "json", false, "Etc/GMT+5")).toBe(
      "/api/cards/card-1/leads/export?format=json&include_spam=false&tz=Etc%2FGMT%2B5",
    );
  });
});

describe("fileNameFromDisposition", () => {
  test("LEA-022 file name read from Content-Disposition", () => {
    expect(fileNameFromDisposition('attachment; filename="contacts-alice-salon-2027-03-15.csv"')).toBe(
      "contacts-alice-salon-2027-03-15.csv",
    );
    expect(fileNameFromDisposition("attachment; filename=contacts-alice-2027-03-15.xlsx")).toBe(
      "contacts-alice-2027-03-15.xlsx",
    );
    expect(fileNameFromDisposition("attachment; filename=contacts-alice-2027-03-15.json; size=3")).toBe(
      "contacts-alice-2027-03-15.json",
    );
    expect(fileNameFromDisposition("attachment")).toBeNull();
    expect(fileNameFromDisposition(null)).toBeNull();
  });
});

describe("downloadExport", () => {
  const PATH = "/api/events/ev-1/leads/export?format=csv&include_spam=false&tz=Europe%2FParis";
  const urlMethods = ["createObjectURL", "revokeObjectURL"] as const;
  const originals = urlMethods.map((name) => Object.getOwnPropertyDescriptor(URL, name));
  let clicked: { download: string; href: string; connected: boolean }[];
  let revoke: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clicked = [];
    revoke = vi.fn();
    // jsdom has no object URLs: define them on the real `URL` for one test, restored afterwards.
    Object.defineProperty(URL, "createObjectURL", { configurable: true, writable: true, value: vi.fn(() => "blob:export-1") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, writable: true, value: revoke });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ download: this.download, href: this.href, connected: this.isConnected });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    urlMethods.forEach((name, index) => {
      const original = originals[index];
      if (original) Object.defineProperty(URL, name, original);
      else delete (URL as unknown as Record<string, unknown>)[name];
    });
  });

  test("LEA-021 the temporary file URL is revoked after a delay, not right after the click", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("a\r\n", { status: 200 })));

    await downloadExport(async () => "tok", PATH);

    expect(clicked).toHaveLength(1);
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:export-1");
  });

  test("LEA-021 LEA-022 the export is fetched with the token and saved under the server's file name", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response("a,b\r\n", {
          status: 200,
          headers: { "content-disposition": 'attachment; filename="contacts-alice-2027-03-15.csv"' },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const name = await downloadExport(async () => "tok", PATH);

    expect(name).toBe("contacts-alice-2027-03-15.csv");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(PATH);
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer tok");
    expect(clicked).toEqual([{ download: "contacts-alice-2027-03-15.csv", href: "blob:export-1", connected: true }]);
    expect(document.querySelector("a[download]")).toBeNull();
  });

  test("LEA-022 without a Content-Disposition the file still gets a name with the format's extension", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    const name = await downloadExport(async () => null, PATH.replace("format=csv", "format=json"));
    expect(name).toBe("contacts.json");
    expect(clicked[0]?.download).toBe("contacts.json");
  });

  test("LEA-021 a refused download throws the ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { code: "not_found", message: "nope", request_id: "req-7" } }), {
            status: 404,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    const failure = await downloadExport(async () => "tok", PATH).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).code).toBe("not_found");
    expect((failure as ApiError).status).toBe(404);
    expect(clicked).toEqual([]);
  });
});
