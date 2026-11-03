import { describe, expect, test, vi } from 'vitest';
import { ApiError, createApiClient } from './index';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function mockFetch(response: () => Response) {
  const fn = vi.fn(async (_request: Request) => response());
  return fn;
}

function client(fetch: (request: Request) => Promise<Response>, token: string | null) {
  return createApiClient({
    baseUrl: 'http://api.test',
    getToken: async () => token,
    fetch,
  });
}

const okBody = { id: 'u1', email: null, display_name: null, status: 'approved', is_admin: false };
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

describe('api client', () => {
  test('adds bearer token and request id', async () => {
    const fetch = mockFetch(() => json(okBody));
    const { data } = await client(fetch, 't').GET('/api/me');
    expect(data?.status).toBe('approved');
    const request = fetch.mock.calls[0]![0];
    expect(request.headers.get('authorization')).toBe('Bearer t');
    expect(request.headers.get('x-request-id')).toMatch(UUID_V4);
  });

  test('sends a fresh request id on every request', async () => {
    const fetch = mockFetch(() => json(okBody));
    const api = client(fetch, 't');
    await api.GET('/api/me');
    await api.GET('/api/me');
    const ids = fetch.mock.calls.map(([request]) => request.headers.get('x-request-id'));
    expect(new Set(ids).size).toBe(2);
  });

  test('still sends the request without an id outside a secure context', async () => {
    // Over plain http on a LAN address (a phone), `crypto.randomUUID` is not available.
    for (const stub of [undefined, {}]) {
      vi.stubGlobal('crypto', stub);
      try {
        const fetch = mockFetch(() => json(okBody));
        const { data } = await client(fetch, 't').GET('/api/me');
        expect(data?.status).toBe('approved');
        const request = fetch.mock.calls[0]![0];
        expect(request.headers.get('authorization')).toBe('Bearer t');
        expect(request.headers.has('x-request-id')).toBe(false);
      } finally {
        vi.unstubAllGlobals();
      }
    }
  });

  test('omits Authorization when no token', async () => {
    const fetch = mockFetch(() => json({ status: 'ok', db: 'ok' }));
    await client(fetch, null).GET('/api/health');
    const request = fetch.mock.calls[0]![0];
    expect(request.headers.has('authorization')).toBe(false);
    expect(request.headers.get('x-request-id')).toMatch(UUID_V4);
  });

  test('throws ApiError with code and requestId from error body', async () => {
    const fetch = mockFetch(() =>
      json(
        { error: { code: 'account_pending', message: 'Your account is awaiting approval.', request_id: 'r1' } },
        403,
        { 'x-request-id': 'header-id' },
      ),
    );
    const error = await client(fetch, 't')
      .GET('/api/me')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(403);
    expect(apiError.code).toBe('account_pending');
    expect(apiError.requestId).toBe('r1');
    expect(apiError.message).toBe('Your account is awaiting approval.');
  });

  test('EDI-015 carries the field errors of a validation_failed response', async () => {
    const fields = [
      { field: 'links[0].url', code: 'invalid_url' },
      { field: 'content.email', code: 'invalid_email' },
    ];
    const fetch = mockFetch(() =>
      json({ error: { code: 'validation_failed', message: 'Invalid fields.', request_id: 'r2', fields } }, 400),
    );
    const error = (await client(fetch, 't')
      .GET('/api/me')
      .catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe('validation_failed');
    expect(error.fields).toEqual(fields);
  });

  test('EDI-015 fields ignores what is not a field error', async () => {
    const cases: [unknown, { field: string; code: string }[]][] = [
      [undefined, []],
      ['nope', []],
      [[{ field: 1 }, null, { field: 'slug', code: 'required' }], [{ field: 'slug', code: 'required' }]],
    ];
    for (const [fields, expected] of cases) {
      const fetch = mockFetch(() =>
        json({ error: { code: 'validation_failed', message: 'x', request_id: 'r3', fields } }, 400),
      );
      const error = (await client(fetch, 't')
        .GET('/api/me')
        .catch((e: unknown) => e)) as ApiError;
      expect(error.fields).toEqual(expected);
    }
    const plain = (await client(mockFetch(() => new Response('oops', { status: 500 })), null)
      .GET('/api/health')
      .catch((e: unknown) => e)) as ApiError;
    expect(plain.fields).toEqual([]);
  });

  test('falls back to header request id on non-JSON error', async () => {
    const fetch = mockFetch(
      () => new Response('Bad Gateway', { status: 502, headers: { 'x-request-id': 'h1' } }),
    );
    const error = (await client(fetch, 't')
      .GET('/api/me')
      .catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(502);
    expect(error.code).toBe('unknown');
    expect(error.requestId).toBe('h1');
  });

  test('requestId is null when neither body nor header carry one', async () => {
    const fetch = mockFetch(() => new Response('oops', { status: 500 }));
    const error = (await client(fetch, null)
      .GET('/api/health')
      .catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe('unknown');
    expect(error.requestId).toBeNull();
  });

  test('does not throw on 2xx', async () => {
    const fetch = mockFetch(() => json({ status: 'ok', db: 'ok' }));
    const { response } = await client(fetch, null).GET('/api/health');
    expect(response.status).toBe(200);
  });
});
