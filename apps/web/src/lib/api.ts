"use client";

import * as Sentry from "@sentry/nextjs";
import { ApiError, createApiClient } from "@cartouche/api-client";
import { useMemo } from "react";
import { useAuth } from "./auth/context";

type ApiClient = ReturnType<typeof createApiClient>;

const METHODS = ["GET", "PUT", "POST", "DELETE", "OPTIONS", "HEAD", "PATCH", "TRACE"] as const;

function report(error: unknown): void {
  if (!(error instanceof ApiError)) return;
  // captureException is a no-op when Sentry was not initialised (no DSN).
  Sentry.captureException(error, {
    ...(error.requestId ? { tags: { request_id: error.requestId } } : {}),
    extra: { status: error.status, code: error.code },
  });
}

/** Reports every ApiError to Sentry (tagged with its request id), then rethrows it untouched. */
export function withErrorReporting(client: ApiClient): ApiClient {
  const wrapped: Record<string, unknown> = { ...client };
  for (const method of METHODS) {
    const original = client[method].bind(client) as (...args: unknown[]) => Promise<unknown>;
    wrapped[method] = async (...args: unknown[]) => {
      try {
        return await original(...args);
      } catch (error) {
        report(error);
        throw error;
      }
    };
  }
  return wrapped as unknown as ApiClient;
}

/** Memoised API client bound to the current session. Same-origin: requests go through the /api rewrite. */
export function useApi(): ApiClient {
  const { getToken } = useAuth();
  return useMemo(() => withErrorReporting(createApiClient({ baseUrl: "", getToken })), [getToken]);
}
