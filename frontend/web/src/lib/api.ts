"use client";

import * as Sentry from "@sentry/nextjs";
import { ApiError, createApiClient } from "@cartouche/api-client";
import { useCallback, useMemo } from "react";
import { useAuth } from "./auth/context";
import { downloadExport } from "./events/lead-export";
import { uploadMedia, type UploadMedia } from "./media/upload";

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

/** Uploads a media of a card as the current session; a failure is reported like those of `useApi`. */
export function useUploadMedia(cardId: string): UploadMedia {
  const { getToken } = useAuth();
  return useCallback(
    async (slot, file, poster) => {
      try {
        return await uploadMedia(getToken, cardId, slot, file, poster);
      } catch (error) {
        report(error);
        throw error;
      }
    },
    [getToken, cardId],
  );
}

/** Downloads an export of leads as the current session; a failure is reported like those of `useApi`. */
export function useDownloadExport(): (path: string) => Promise<string> {
  const { getToken } = useAuth();
  return useCallback(
    async (path) => {
      try {
        return await downloadExport(getToken, path);
      } catch (error) {
        report(error);
        throw error;
      }
    },
    [getToken],
  );
}
