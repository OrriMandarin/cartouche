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
  let clicked: { download: string; href: string; connected: boolean }[];

  beforeEach(() => {
    clicked = [];
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:export-1"), revokeObjectURL: vi.fn() }));
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ download: this.download, href: this.href, connected: this.isConnected });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:export-1");
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
