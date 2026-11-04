"use client";

import { ApiError, type components } from "@cartouche/api-client";
import { CircleX, Clock, Lock, LogOut, Mail, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { DeleteAccount, type AccountTotals } from "@/components/account/DeleteAccount";
import { ErrorNotice } from "@/components/ErrorNotice";
import { AppShell, type ShellSlots } from "@/components/shell/AppShell";
import { BrandMark } from "@/components/shell/BrandMark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useApi } from "@/lib/api";
import { useAuth } from "@/lib/auth/context";
import { supportMailto } from "@/lib/instance-links";

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

type StatusTone = "warning" | "danger" | "neutral";

const TONE_ICON_CLASS: Record<StatusTone, string> = {
  warning: "bg-app-warning-soft text-app-warning",
  danger: "bg-app-danger-soft text-app-danger",
  neutral: "bg-app-neutral-soft text-app-neutral",
};

/** The card of a status that keeps the account out of the dashboard (ACC-026), with its way out. */
function StatusNotice({
  testId,
  tone,
  Icon,
  badge,
  title,
  description,
  withSupport,
  totals,
  onSignOut,
}: {
  testId: string;
  tone: StatusTone;
  Icon: LucideIcon;
  badge: string;
  title: string;
  description: string;
  withSupport: boolean;
  totals: AccountTotals;
  onSignOut: () => void;
}) {
  const t = useTranslations("account");
  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col gap-4">
      <div
        data-testid={testId}
        className="bg-app-surface border-app-border rounded-app-lg shadow-app-sm flex flex-col items-center gap-4 border p-6 text-center min-[600px]:px-12 min-[600px]:pt-12 min-[600px]:pb-10"
      >
        <div className={`grid size-16 place-items-center rounded-full ${TONE_ICON_CLASS[tone]}`}>
          <Icon className="size-7" aria-hidden="true" />
        </div>
        <Badge variant={tone}>{badge}</Badge>
        <h1 className="font-app-display max-w-[18ch] text-[27px] leading-[1.15] font-semibold tracking-[-0.015em] min-[600px]:text-[32px] min-[600px]:leading-[1.12]">
          {title}
        </h1>
        <p className="text-app-muted max-w-[44ch] text-[15px] leading-[1.55] min-[600px]:text-base">{description}</p>
        <div className="mt-2 flex flex-col-reverse flex-wrap justify-center gap-2.5 min-[600px]:flex-row">
          <Button variant="secondary" data-testid="sign-out" onClick={onSignOut}>
            <LogOut aria-hidden="true" />
            {t("actions.signOut")}
          </Button>
          {withSupport ? (
            <Button asChild>
              <a href={supportMailto()} data-testid="account-support">
                <Mail aria-hidden="true" />
                {t("actions.support")}
              </a>
            </Button>
          ) : null}
        </div>
      </div>
      {/* Offers the deletion of the account under the screen (ACC-021): the screens of an existing account only. */}
      <div className="flex justify-center">
        <DeleteAccount isAdmin={false} totals={totals} />
      </div>
    </div>
  );
}

/** A plain notice for the cases without an account to act on (sign-up closed). */
function Notice({ testId, title, description }: { testId: string; title: string; description: string }) {
  return (
    <Card data-testid={testId} className="mx-auto max-w-xl">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
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
  const tAuth = useTranslations("auth");
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
      <AppShell user={{ name, email: state.me.email }} isAdmin={state.me.is_admin} onSignOut={() => void signOut()} {...shell}>
        <MeContext.Provider value={state.me}>{children}</MeContext.Provider>
      </AppShell>
    );
  }

  let body: ReactNode;
  const statusNotice = (props: {
    testId: string;
    tone: StatusTone;
    Icon: LucideIcon;
    key: "pending" | "rejected" | "suspended";
    description: string;
    withSupport: boolean;
  }) => {
    return (
      <StatusNotice
        testId={props.testId}
        tone={props.tone}
        Icon={props.Icon}
        badge={t(`${props.key}.badge`)}
        title={t(`${props.key}.title`)}
        description={props.description}
        withSupport={props.withSupport}
        totals={state.kind === "ready" ? state.me.totals : { cards: 0, events: 0, leads: 0 }}
        onSignOut={() => void signOut()}
      />
    );
  };
  if (state.kind === "signup-closed") {
    body = <Notice testId="signup-closed" title={t("signupClosed.title")} description={t("signupClosed.description")} />;
  } else if (state.kind === "error") {
    body = <ErrorNotice error={state.error} />;
  } else if (state.kind === "ready" && state.me.status === "pending") {
    body = statusNotice({
      testId: "account-pending",
      tone: "warning",
      Icon: Clock,
      key: "pending",
      description: state.me.email
        ? t("pending.description", { email: state.me.email })
        : t("pending.descriptionNoEmail"),
      withSupport: false,
    });
  } else if (state.kind === "ready" && state.me.status === "rejected") {
    body = statusNotice({
      testId: "account-rejected",
      tone: "danger",
      Icon: CircleX,
      key: "rejected",
      description: t("rejected.description"),
      withSupport: true,
    });
  } else if (state.kind === "ready" && state.me.status === "suspended") {
    body = statusNotice({
      testId: "account-suspended",
      tone: "neutral",
      Icon: Lock,
      key: "suspended",
      description: t("suspended.description"),
      withSupport: true,
    });
  }

  // The status cards carry their own sign-out; the other screens keep it in the header.
  const signOutInHeader = state.kind !== "ready";
  const identity = state.kind === "ready" && state.me.email ? state.me.email : name;

  // The accounts that do not reach the dashboard get a plain header, with the sign-out when the screen has none.
  return (
    <div className="flex min-h-dvh flex-col">
      <header
        data-testid="account-header"
        className="border-app-border flex items-center justify-between gap-4 border-b px-5 py-5 min-[600px]:px-10"
      >
        <span className="font-app-display inline-flex items-center gap-2.5 text-[22px] leading-none font-semibold tracking-[-0.01em]">
          <BrandMark />
          {tAuth("brand")}
        </span>
        <span className="flex items-center gap-4">
          <span className="text-app-muted hidden text-[13px] min-[600px]:inline">
            {t("header.signedInAs", { name: identity })}
          </span>
          {signOutInHeader ? (
            <Button variant="secondary" size="sm" data-testid="sign-out" onClick={() => void signOut()}>
              {t("header.signOut")}
            </Button>
          ) : null}
        </span>
      </header>
      <div className="flex flex-1 items-center justify-center px-5 py-10 min-[600px]:px-10">{body}</div>
    </div>
  );
}
