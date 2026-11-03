import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { test as base, expect, request, type APIRequestContext } from "@playwright/test";
import { API_URL } from "./env";

const execFileAsync = promisify(execFile);

const COMPOSE_FILE = "../../compose.test.yml";

export interface SeededUser {
  subject: string;
  status: string;
}

export interface SeededCard {
  id: string;
  /** The current slug. */
  slug: string;
  /** Subject of the owner. */
  owner: string;
}

/** What `POST /api/test/seed` returns: only the rows the scenario created. */
export interface SeedReport {
  users: SeededUser[];
  cards: SeededCard[];
}

export interface MediaView {
  id: string;
  kind: "image" | "video";
  images: { width: number; url: string }[];
  video_url: string | null;
  jpeg_url: string | null;
}

/** A card as its owner sees it (the fields the tests read; the API sends more). */
export interface CardView {
  id: string;
  slug: string;
  public_url: string;
  status: string;
  template: string;
  settings: Record<string, unknown>;
  theme: { preset: string; [key: string]: unknown };
  content: {
    first_name: string | null;
    last_name: string | null;
    job_title: string | null;
    company: string | null;
    description: string | null;
    email: string | null;
    phone: string | null;
    phone_display: string | null;
  };
  links: { kind: string; url: string; label: string | null }[];
  header: MediaView | null;
  avatar: MediaView | null;
  created_at: string;
  updated_at: string;
}

export interface UploadFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

/** An `APIRequestContext` aimed at the API of the test stack, plus helpers for its `/api/test/*` routes. */
export type TestApi = APIRequestContext & {
  /** Empties the database. */
  reset(): Promise<void>;
  /** Loads a seed scenario (`base`, then `cards`). */
  seed(scenario: string): Promise<SeedReport>;
  /** Freezes the API clock at an RFC 3339 instant, or releases it with `null`. */
  setClock(iso: string | null): Promise<void>;
  /** Mints a token for a subject, signed by the test issuer. */
  token(subject: string): Promise<string>;
  /** `Authorization` header for a subject, to pass to `api.get`/`post`/`put`/`delete`. */
  authHeaders(subject: string): Promise<{ authorization: string }>;
  /**
   * Edits a card as its owner: reads it, merges `patch` over it and saves the whole.
   * `content` is merged field by field; every other key of `patch` replaces the stored one.
   * `header_media_id` and `avatar_media_id` name uploaded media (`null` removes it).
   * Fails unless the API answers 2xx.
   */
  updateCard(subject: string, id: string, patch: Record<string, unknown>): Promise<CardView>;
  /** Uploads a header or avatar media (with `poster` for a video); the card shows it once saved with its id. */
  uploadMedia(
    subject: string,
    cardId: string,
    slot: "header" | "avatar",
    file: UploadFile,
    poster?: UploadFile,
  ): Promise<MediaView>;
};

async function ensureOk(label: string, response: { ok(): boolean; status(): number; text(): Promise<string> }) {
  if (!response.ok()) {
    throw new Error(`${label} failed with ${response.status()}: ${await response.text()}`);
  }
}

async function createApi(): Promise<TestApi> {
  const context = await request.newContext({ baseURL: API_URL });
  const token = async (subject: string) => {
    const response = await context.post("/api/test/token", { data: { subject } });
    await ensureOk("POST /api/test/token", response);
    return ((await response.json()) as { token: string }).token;
  };
  const authHeaders = async (subject: string) => ({ authorization: `Bearer ${await token(subject)}` });
  const helpers = {
    async reset() {
      await ensureOk("POST /api/test/reset", await context.post("/api/test/reset"));
    },
    async seed(scenario: string) {
      const response = await context.post("/api/test/seed", { data: { scenario } });
      await ensureOk("POST /api/test/seed", response);
      return (await response.json()) as SeedReport;
    },
    async setClock(iso: string | null) {
      await ensureOk("POST /api/test/clock", await context.post("/api/test/clock", { data: { now: iso } }));
    },
    token,
    authHeaders,
    async updateCard(subject: string, id: string, patch: Record<string, unknown>) {
      const headers = await authHeaders(subject);
      const current = await context.get(`/api/cards/${id}`, { headers });
      await ensureOk(`GET /api/cards/${id}`, current);
      const card = (await current.json()) as CardView;
      // The PUT body replaces the whole card: start from what is stored, minus what the API computes.
      const { content, header, avatar, ...rest } = card;
      const { phone_display: _display, ...editable } = content;
      const { id: _id, public_url: _url, status: _status, created_at: _c, updated_at: _u, ...stored } = rest;
      const { content: contentPatch, ...patchRest } = patch;
      const body = {
        ...stored,
        header_media_id: header?.id ?? null,
        avatar_media_id: avatar?.id ?? null,
        ...patchRest,
        content: { ...editable, ...(contentPatch as Record<string, unknown> | undefined) },
      };
      const response = await context.put(`/api/cards/${id}`, { headers, data: body });
      await ensureOk(`PUT /api/cards/${id}`, response);
      return (await response.json()) as CardView;
    },
    async uploadMedia(
      subject: string,
      cardId: string,
      slot: "header" | "avatar",
      file: UploadFile,
      poster?: UploadFile,
    ) {
      const response = await context.post(`/api/cards/${cardId}/media`, {
        headers: await authHeaders(subject),
        multipart: { slot, file, ...(poster ? { poster } : {}) },
      });
      await ensureOk(`POST /api/cards/${cardId}/media`, response);
      return (await response.json()) as MediaView;
    },
  };
  return Object.assign(context, helpers);
}

interface Fixtures {
  /** The test API. */
  api: TestApi;
  /** Signs the page in as `subject`: the session is in place before any script of the app runs. */
  loginAs: (subject: string) => Promise<void>;
  /** Resets the database to the `base` scenario before every test (automatic). */
  freshState: void;
  /** Attaches the API logs of a failed test (automatic). */
  apiLogs: void;
}

export const test = base.extend<Fixtures>({
  api: async ({}, use) => {
    const api = await createApi();
    await use(api);
    await api.dispose();
  },

  loginAs: async ({ page, api }, use) => {
    await use(async (subject: string) => {
      const token = await api.token(subject);
      await page.addInitScript(
        ([t, s]) => {
          sessionStorage.setItem("cartouche.test.token", t);
          sessionStorage.setItem("cartouche.test.subject", s);
        },
        [token, subject] as const,
      );
    });
  },

  freshState: [
    async ({ api }, use) => {
      await api.reset();
      await api.seed("base");
      await api.setClock(null);
      await use();
    },
    { auto: true },
  ],

  apiLogs: [
    async ({}, use, testInfo) => {
      // One second of margin: the containers' clock and ours are not the same.
      const started = new Date(Date.now() - 1000).toISOString();
      await use();
      if (testInfo.status === testInfo.expectedStatus) return;
      let logs: string;
      try {
        const { stdout, stderr } = await execFileAsync(
          "docker",
          ["compose", "-f", COMPOSE_FILE, "logs", "api", "--since", started, "--no-color"],
          { cwd: import.meta.dirname, maxBuffer: 16 * 1024 * 1024 },
        );
        logs = stdout + stderr;
      } catch (error) {
        logs = `Could not read the API logs: ${String(error)}`;
      }
      // A file next to the trace, video and screenshot, so it can be read straight from `test-results/`.
      const path = testInfo.outputPath("api-logs.txt");
      await writeFile(path, logs);
      await testInfo.attach("api-logs", { path, contentType: "text/plain" });
    },
    { auto: true },
  ],
});

export { expect };
