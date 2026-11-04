import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { test as base, expect, request, type APIRequestContext, type Download, type Locator, type Page } from "@playwright/test";
import { API_URL, EVENTS_NOW } from "./env";

/** How a media is framed on upload (MED-026, MED-028); what is left out takes the server's default. */
export interface UploadFraming {
  crop?: { x: number; y: number; width: number; height: number };
  loop?: { start: number; end: number };
  posterTime?: number;
}

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

export interface SeededEvent {
  id: string;
  /** The slug of the card the event belongs to. */
  card_slug: string;
  title: string;
}

/** What `POST /api/test/seed` returns: only the rows the scenario created. */
export interface SeedReport {
  users: SeededUser[];
  cards: SeededCard[];
  events: SeededEvent[];
}

export interface StandardFields {
  first_name: FieldMode;
  last_name: FieldMode;
  birth_date: FieldMode;
  email: FieldMode;
  phone: FieldMode;
  address: FieldMode;
}

export type FieldMode = "off" | "optional" | "required";

export interface CustomFieldView {
  id: string;
  label: string;
  kind: "text" | "long_text" | "date" | "datetime" | "number" | "single_choice" | "checkbox";
  required: boolean;
  help: string | null;
  options: string[];
}

/** An event as its owner sees it (the fields the tests read; the API sends more). */
export interface EventView {
  id: string;
  card_id: string;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string | null;
  phase: "upcoming" | "running" | "past";
  access_code: string | null;
  device_limit: number;
  standard_fields: StandardFields;
  custom_fields: CustomFieldView[];
  consent_text: string | null;
  default_consent_text: string;
  lead_count: number;
  created_at: string;
  updated_at: string;
}

/** A contact as the owner of its event sees it. */
export interface LeadView {
  id: string;
  event_id: string;
  /** The title the event has now. */
  event_title: string;
  submitted_at: string;
  spam: boolean;
  answers: {
    first_name: string | null;
    last_name: string | null;
    birth_date: string | null;
    email: string | null;
    phone: string | null;
    street: string | null;
    postal_code: string | null;
    city: string | null;
    country: string | null;
  };
  phone_display: string | null;
  custom: { field_id: string; label: string; kind: string; value: unknown }[];
  consent_at: string;
  consent_text: string;
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
  /**
   * Sets up the events tests: empties the database, freezes the clock at `EVENTS_NOW`, then
   * loads `base`, `cards` and `events` (reports merged). Sign in (`loginAs`, `api.token`) only
   * afterwards: a token signed at real time is expired for a clock in 2027.
   */
  seedEvents(): Promise<SeedReport>;
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
  /**
   * Edits an event as its owner: reads it, merges `patch` over it and saves the whole.
   * Fails unless the API answers 2xx.
   */
  updateEvent(subject: string, id: string, patch: Record<string, unknown>): Promise<EventView>;
  /** The contacts of an event as its owner sees them, newest first, spam ones included. */
  leads(subject: string, eventId: string): Promise<LeadView[]>;
  /** The contacts of all the events of a card as its owner sees them, newest first, spam ones included. */
  cardLeads(subject: string, cardId: string): Promise<LeadView[]>;
  /** Uploads a header or avatar media (with `poster` for a video, and optionally its `framing`); the card shows it once saved with its id. */
  uploadMedia(
    subject: string,
    cardId: string,
    slot: "header" | "avatar",
    file: UploadFile,
    poster?: UploadFile,
    framing?: UploadFraming,
  ): Promise<MediaView>;
};

/** The file a download saved, as bytes. */
export async function downloadedBytes(download: Download): Promise<Buffer> {
  const path = await download.path();
  return readFile(path);
}

/** The file a download saved, read as UTF-8 text. */
export async function downloadedText(download: Download): Promise<string> {
  return (await downloadedBytes(download)).toString("utf8");
}

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
  const reset = async () => {
    await ensureOk("POST /api/test/reset", await context.post("/api/test/reset"));
  };
  const seed = async (scenario: string) => {
    const response = await context.post("/api/test/seed", { data: { scenario } });
    await ensureOk("POST /api/test/seed", response);
    return (await response.json()) as SeedReport;
  };
  const setClock = async (iso: string | null) => {
    await ensureOk("POST /api/test/clock", await context.post("/api/test/clock", { data: { now: iso } }));
  };
  const helpers = {
    reset,
    seed,
    setClock,
    async seedEvents() {
      await reset();
      await setClock(EVENTS_NOW);
      const base = await seed("base");
      const cards = await seed("cards");
      const events = await seed("events");
      return {
        users: [...base.users, ...cards.users, ...events.users],
        cards: [...base.cards, ...cards.cards, ...events.cards],
        events: [...base.events, ...cards.events, ...events.events],
      };
    },
    token,
    authHeaders,
    async updateEvent(subject: string, id: string, patch: Record<string, unknown>) {
      const headers = await authHeaders(subject);
      const current = await context.get(`/api/events/${id}`, { headers });
      await ensureOk(`GET /api/events/${id}`, current);
      const event = (await current.json()) as EventView;
      // The PUT body replaces the whole event: start from what is stored, minus what the API computes.
      const {
        id: _id,
        card_id: _card,
        phase: _phase,
        default_consent_text: _default,
        lead_count: _count,
        created_at: _c,
        updated_at: _u,
        ...stored
      } = event;
      const response = await context.put(`/api/events/${id}`, { headers, data: { ...stored, ...patch } });
      await ensureOk(`PUT /api/events/${id}`, response);
      return (await response.json()) as EventView;
    },
    async leads(subject: string, eventId: string) {
      const response = await context.get(`/api/events/${eventId}/leads`, {
        headers: await authHeaders(subject),
      });
      await ensureOk(`GET /api/events/${eventId}/leads`, response);
      return ((await response.json()) as { leads: LeadView[] }).leads;
    },
    async cardLeads(subject: string, cardId: string) {
      const response = await context.get(`/api/cards/${cardId}/leads`, {
        headers: await authHeaders(subject),
      });
      await ensureOk(`GET /api/cards/${cardId}/leads`, response);
      return ((await response.json()) as { leads: LeadView[] }).leads;
    },
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
      framing: UploadFraming = {},
    ) {
      const response = await context.post(`/api/cards/${cardId}/media`, {
        headers: await authHeaders(subject),
        multipart: {
          slot,
          file,
          ...(poster ? { poster } : {}),
          ...(framing.crop ? { crop: JSON.stringify(framing.crop) } : {}),
          ...(framing.loop ? { loop: JSON.stringify(framing.loop) } : {}),
          ...(framing.posterTime !== undefined ? { poster_time: String(framing.posterTime) } : {}),
        },
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

/** Opens the « Plus d’actions » menu of a card of the dashboard. */
export async function openCardMenu(page: Page, slug: string): Promise<void> {
  // A menu that was just used may still be closing.
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page.getByTestId(`card-menu-${slug}`).click();
  await expect(page.getByRole("menu")).toBeVisible();
}

/**
 * The card editor's « Enregistrer »: in the top bar on a computer, in the sticky save bar on a phone
 * (EDI-003). Only one of them is shown at a time.
 */
export function editorSaveButton(page: Page): Locator {
  return page.locator('[data-testid="editor-save"]:visible, [data-testid="editor-save-bar"]:visible');
}

/** Saves the card and waits for the confirmation (EDI-027). */
export async function saveCard(page: Page): Promise<void> {
  await editorSaveButton(page).click();
  await expect(page.getByText("Carte enregistrée et publiée")).toBeVisible();
}

export type EditorSection = "identity" | "contact" | "links" | "media" | "template" | "theme";

/** Unfolds a section of the card editor on a phone; a computer shows every section already. */
export async function openEditorSection(page: Page, section: EditorSection): Promise<void> {
  // The editor appears once the card is loaded; only then does the toggle tell whether it is shown.
  await expect(page.getByTestId("card-editor")).toBeVisible();
  const toggle = page.getByTestId(`editor-section-toggle-${section}`);
  if ((await toggle.isVisible()) && (await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
  await expect(page.getByTestId(`editor-section-body-${section}`)).toBeVisible();
}

/** Shows the « Aperçu » or the « Modifier » view of the card editor on a phone; a computer shows both. */
export async function showEditorView(page: Page, view: "Modifier" | "Aperçu"): Promise<void> {
  await expect(page.getByTestId("card-editor")).toBeVisible();
  const tab = page.getByRole("tab", { name: view });
  if (await tab.isVisible()) await tab.click();
}
