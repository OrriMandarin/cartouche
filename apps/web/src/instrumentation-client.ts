import * as Sentry from "@sentry/nextjs";

// Sentry is optional: nothing is initialised unless a DSN is configured.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({ dsn, tracesSampleRate: 0 });
}

export const onRouterTransitionStart = dsn ? Sentry.captureRouterTransitionStart : undefined;
