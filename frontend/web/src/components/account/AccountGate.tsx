"use client";

import { ApiError, type components } from "@cartouche/api-client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { DeleteAccount } from "@/components/account/DeleteAccount";
import { ErrorNotice } from "@/components/ErrorNotice";
import { AppShell, type ShellSlots } from "@/components/shell/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useApi } from "@/lib/api";
import { useAuth } from "@/lib/auth/context";

export type Me = components["schemas"]["MeResponse"];

const MeContext = createContext<Me | null>(null);

/** The signed-in user's account. Only usable below an `<AccountGate>` that let the account through. */
export function useMe(): Me {
  const me = useContext(MeContext);
  if (me === null) {
    throw new Error("useMe must be used inside <AccountGate>");
  }
  return me;
}

type State =
  | { kind: "loading" }
  | { kind: "ready"; me: Me }
  | { kind: "signup-closed" }
  | { kind: "error"; error: unknown };

function Notice({
  testId,
  title,
  description,
  deletable = false,
}: {
  testId: string;
  title: string;
  description: string;
  /** Offers the deletion of the account under the text (ACC-021): the screens of an existing account only. */
  deletable?: boolean;
}) {
  return (
    <Card data-testid={testId} className="mx-auto max-w-xl">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      {deletable ? (
        <CardContent>
          <DeleteAccount isAdmin={false} />
        </CardContent>
      ) : null}
    </Card>
  );
}

/**
 * spec: ACC-004. Loads GET /api/me and only renders its children for an approved account;
 * the other statuses get a dedicated screen. Redirects to /login when signed out.
 * An approved account is rendered inside the dashboard shell (EDI-022), configured by the slot props.
 */
export function AccountGate({ children, ...shell }: ShellSlots & { children: ReactNode }) {
  const t = useTranslations("account");
  const router = useRouter();
  const api = useApi();
  const { status: authStatus, user, signOut } = useAuth();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    if (authStatus === "signed-out") {
      router.replace("/login");
    }
  }, [authStatus, router]);

  useEffect(() => {
    if (authStatus !== "signed-in") return;
    let cancelled = false;
    void (async () => {
      let next: State;
      try {
        const { data } = await api.GET("/api/me");
        next = data ? { kind: "ready", me: data } : { kind: "error", error: new Error("empty response") };
      } catch (error) {
        next =
          error instanceof ApiError && error.status === 403 && error.code === "signup_closed"
            ? { kind: "signup-closed" }
            : { kind: "error", error };
      }
      if (!cancelled) setState(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [authStatus, api]);

  if (authStatus !== "signed-in" || state.kind === "loading") {
    return (
      <div data-testid="account-loading" aria-busy="true" className="mx-auto max-w-3xl space-y-4 p-6">
        <div className="bg-muted h-8 w-1/3 animate-pulse rounded" />
        <div className="bg-muted h-24 animate-pulse rounded" />
        <span className="sr-only">{t("loading")}</span>
      </div>
    );
  }

  const name =
    (state.kind === "ready" ? state.me.display_name : null) ?? user?.name ?? user?.email ?? user?.subject ?? "";

  if (state.kind === "ready" && state.me.status === "approved") {
    return (
      <AppShell user={{ name, email: state.me.email }} onSignOut={() => void signOut()} {...shell}>
        <MeContext.Provider value={state.me}>{children}</MeContext.Provider>
      </AppShell>
    );
  }

  let body: ReactNode;
  if (state.kind === "signup-closed") {
    body = <Notice testId="signup-closed" title={t("signupClosed.title")} description={t("signupClosed.description")} />;
  } else if (state.kind === "error") {
    body = <ErrorNotice error={state.error} />;
  } else if (state.kind === "ready" && state.me.status === "pending") {
    body = <Notice testId="account-pending" title={t("pending.title")} description={t("pending.description")} deletable />;
  } else if (state.kind === "ready" && state.me.status === "rejected") {
    body = <Notice testId="account-rejected" title={t("rejected.title")} description={t("rejected.description")} deletable />;
  } else if (state.kind === "ready" && state.me.status === "suspended") {
    body = <Notice testId="account-suspended" title={t("suspended.title")} description={t("suspended.description")} deletable />;
  }

  // The accounts that do not reach the dashboard get a plain header, with the sign-out.
  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <header data-testid="account-header" className="mb-8 flex items-center justify-between gap-4 border-b pb-4">
        <span className="font-semibold">{t("header.signedInAs", { name })}</span>
        <Button variant="outline" size="sm" data-testid="sign-out" onClick={() => void signOut()}>
          {t("header.signOut")}
        </Button>
      </header>
      {body}
    </div>
  );
}
