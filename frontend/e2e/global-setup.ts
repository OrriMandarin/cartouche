import { API_URL } from "./env";

const TIMEOUT_MS = 60_000;

/** Waits until the API of the test stack answers its health check. */
export default async function globalSetup(): Promise<void> {
  const deadline = Date.now() + TIMEOUT_MS;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${API_URL}/api/health`);
      if (response.ok) return;
      lastError = new Error(`GET /api/health answered ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`The API at ${API_URL} is not healthy (is the stack up? try \`make e2e\`): ${String(lastError)}`);
}
