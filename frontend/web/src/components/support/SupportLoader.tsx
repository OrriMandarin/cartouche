"use client";

import { ApiError } from "@cartouche/api-client";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ErrorNotice } from "@/components/ErrorNotice";

type State<T> =
  | { kind: "loading" }
  | { kind: "ready"; data: T }
  | { kind: "not-found" }
  | { kind: "error"; error: unknown };

/** An id that does not exist and one that is not an id at all both lead to « not found ». */
function isMissing(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 400);
}

/**
 * Loads one resource of the support pages and hands it, with a `reload`, to its children.
 * `reload` refetches in place (no loading screen) and resolves when the fresh data is shown.
 */
export function SupportLoader<T>({
  load,
  notFound,
  children,
}: {
  load: () => Promise<T>;
  /** Message shown when the resource does not exist. */
  notFound: string;
  children: (data: T, reload: () => Promise<void>) => ReactNode;
}) {
  const t = useTranslations("support");
  const [state, setState] = useState<State<T>>({ kind: "loading" });

  const fetchState = useCallback(async (): Promise<State<T>> => {
    try {
      return { kind: "ready", data: await load() };
    } catch (error) {
      return isMissing(error) ? { kind: "not-found" } : { kind: "error", error };
    }
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    void fetchState().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchState]);

  const reload = useCallback(async () => setState(await fetchState()), [fetchState]);

  switch (state.kind) {
    case "loading":
      return (
        <p data-testid="support-loading" className="text-app-muted py-6 text-center">
          {t("loading")}
        </p>
      );
    case "not-found":
      return (
        <p data-testid="support-not-found" className="text-app-muted py-10 text-center text-lg">
          {notFound}
        </p>
      );
    case "error":
      return <ErrorNotice error={state.error} />;
    case "ready":
      return children(state.data, reload);
  }
}
