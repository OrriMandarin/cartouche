import { toApiError } from "@cartouche/api-client";

export type ExportFormat = "csv" | "xlsx" | "json";

/** What an export covers (LEA-021): one event, or every event of a card. */
export type ExportScope = { kind: "event"; id: string } | { kind: "card"; id: string };

/** spec: LEA-021, LEA-026. The export route of `scope`, with the format, the spam option and the user's time zone. */
export function exportPath(scope: ExportScope, format: ExportFormat, includeSpam: boolean, zone: string): string {
  const base = scope.kind === "event" ? "events" : "cards";
  const query = `format=${format}&include_spam=${includeSpam}&tz=${encodeURIComponent(zone)}`;
  return `/api/${base}/${encodeURIComponent(scope.id)}/leads/export?${query}`;
}

/** spec: LEA-022, LEA-032. The file name of a `Content-Disposition` header, quoted or not; `null` when absent. */
export function fileNameFromDisposition(header: string | null): string | null {
  const match = header?.match(/filename=(?:"([^"]*)"|([^;\s]+))/i);
  return match?.[1] || match?.[2] || null;
}

/** How long the temporary file URL lives after the click, so that every browser has started the download. */
const REVOKE_DELAY_MS = 1000;

/** Only used when the server sends no file name: `contacts` plus the extension of the requested format. */
function fallbackFileName(path: string): string {
  const format = new URLSearchParams(path.split("?")[1] ?? "").get("format");
  return format ? `contacts.${format}` : "contacts";
}

/**
 * spec: LEA-021, LEA-022. Fetches an export as the current session and hands the file to the browser through a
 * temporary link. A refusal is thrown as an `ApiError`. Returns the name the file was saved under.
 */
export async function downloadExport(getToken: () => Promise<string | null>, path: string): Promise<string> {
  const headers = new Headers();
  const token = await getToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(path, { headers });
  if (!response.ok) throw await toApiError(response);

  const name = fileNameFromDisposition(response.headers.get("content-disposition")) ?? fallbackFileName(path);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Revoked later: some Safari versions cancel the download if the URL is revoked right after the click.
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
  }
  return name;
}
