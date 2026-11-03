import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { test as base, expect, request, type APIRequestContext } from "@playwright/test";

const execFileAsync = promisify(execFile);

const API_URL = "http://localhost:18080";
const COMPOSE_FILE = "../compose.test.yml";

export interface SeededUser {
  subject: string;
  status: string;
}

/** An `APIRequestContext` aimed at the API of the test stack, plus helpers for its `/api/test/*` routes. */
export type TestApi = APIRequestContext & {
  /** Empties the database. */
  reset(): Promise<void>;
  /** Loads a seed scenario (`base`). */
  seed(scenario: string): Promise<SeededUser[]>;
  /** Freezes the API clock at an RFC 3339 instant, or releases it with `null`. */
  setClock(iso: string | null): Promise<void>;
  /** Mints a token for a subject, signed by the test issuer. */
  token(subject: string): Promise<string>;
};

async function ensureOk(label: string, response: { ok(): boolean; status(): number; text(): Promise<string> }) {
  if (!response.ok()) {
    throw new Error(`${label} failed with ${response.status()}: ${await response.text()}`);
  }
}

async function createApi(): Promise<TestApi> {
  const context = await request.newContext({ baseURL: API_URL });
  const helpers = {
    async reset() {
      await ensureOk("POST /api/test/reset", await context.post("/api/test/reset"));
    },
    async seed(scenario: string) {
      const response = await context.post("/api/test/seed", { data: { scenario } });
      await ensureOk("POST /api/test/seed", response);
      return ((await response.json()) as { users: SeededUser[] }).users;
    },
    async setClock(iso: string | null) {
      await ensureOk("POST /api/test/clock", await context.post("/api/test/clock", { data: { now: iso } }));
    },
    async token(subject: string) {
      const response = await context.post("/api/test/token", { data: { subject } });
      await ensureOk("POST /api/test/token", response);
      return ((await response.json()) as { token: string }).token;
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
