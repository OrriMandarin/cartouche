import type * as SentryModule from "@sentry/nextjs";

// Sentry is optional: nothing is initialised unless a DSN is configured.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

export async function register() {
  if (!dsn) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.init({ dsn, tracesSampleRate: 0 });
}

export const onRequestError: typeof SentryModule.captureRequestError = (...args) => {
  if (!dsn) return;
  void import("@sentry/nextjs").then((Sentry) => Sentry.captureRequestError(...args));
};
