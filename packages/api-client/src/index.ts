import createClient, { type Client, type Middleware } from 'openapi-fetch';
import type { paths } from './schema';

export type { paths, components } from './schema';

/** A non-2xx API response, built from the `{"error":{...}}` body. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;

  constructor(opts: { status: number; code: string; message: string; requestId: string | null }) {
    super(opts.message);
    this.name = 'ApiError';
    this.status = opts.status;
    this.code = opts.code;
    this.requestId = opts.requestId;
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  /** Resolves the bearer token for the current request, or `null` when signed out. */
  getToken: () => Promise<string | null>;
  /** Custom fetch implementation (tests, server-side wrappers). Defaults to global fetch. */
  fetch?: (request: Request) => Promise<Response>;
}

const REQUEST_ID_HEADER = 'x-request-id';

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

async function toApiError(response: Response): Promise<ApiError> {
  const headerId = response.headers.get(REQUEST_ID_HEADER);
  let code = 'unknown';
  let message = `Request failed with status ${response.status}`;
  let requestId = headerId;
  try {
    const body: unknown = await response.clone().json();
    const error = (body as { error?: unknown } | null)?.error;
    if (error !== null && typeof error === 'object') {
      const detail = error as Record<string, unknown>;
      code = asString(detail.code) ?? code;
      message = asString(detail.message) ?? message;
      requestId = asString(detail.request_id) ?? headerId;
    }
  } catch {
    // Not JSON: keep the fallbacks.
  }
  return new ApiError({ status: response.status, code, message, requestId });
}

export function createApiClient(opts: ApiClientOptions): Client<paths> {
  const client = createClient<paths>({
    baseUrl: opts.baseUrl,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });
  const middleware: Middleware = {
    async onRequest({ request }) {
      const token = await opts.getToken();
      if (token) request.headers.set('authorization', `Bearer ${token}`);
      request.headers.set(REQUEST_ID_HEADER, crypto.randomUUID());
      return request;
    },
    async onResponse({ response }) {
      if (!response.ok) throw await toApiError(response);
      return undefined;
    },
  };
  client.use(middleware);
  return client;
}
