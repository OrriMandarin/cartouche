"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AccountGate } from "@/components/account/AccountGate";
import { ErrorNotice } from "@/components/ErrorNotice";
import { SupportGuard } from "@/components/support/SupportGuard";
import { UserModerationTable, type ModerationUser } from "@/components/support/UserModerationTable";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useApi } from "@/lib/api";
import { USER_STATUSES, type UserStatus } from "@/lib/moderation";

type Counts = Record<UserStatus, number>;

function SupportContent() {
  const t = useTranslations("support");
  const api = useApi();
  const [tab, setTab] = useState<UserStatus>("pending");
  const [users, setUsers] = useState<ModerationUser[] | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [error, setError] = useState<unknown>(null);
  // Bumped after a successful action to refetch the list and the counters.
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let stale = false; // a newer tab or reload superseded this request
    void (async () => {
      try {
        const { data } = await api.GET("/api/admin/users", { params: { query: { status: tab } } });
        if (stale) return;
        if (!data) throw new Error("empty response");
        setUsers(data.users);
        setCounts(data.counts);
        setError(null);
      } catch (e) {
        if (!stale) setError(e);
      }
    })();
    return () => {
      stale = true;
    };
  }, [api, tab, reloads]);

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-bold tracking-tight">{t("title")}</h1>
        <Link href="/dashboard" className="text-sm underline" data-testid="nav-dashboard">
          {t("backToDashboard")}
        </Link>
      </div>
      <Tabs
        value={tab}
        onValueChange={(value) => {
          setUsers(null);
          setTab(value as UserStatus);
        }}
      >
        <TabsList>
          {USER_STATUSES.map((status) => (
            <TabsTrigger key={status} value={status} data-testid={`tab-${status}`}>
              {t(`status.${status}`)}
              <Badge
                variant={status === "pending" && (counts?.pending ?? 0) > 0 ? "warning" : "neutral"}
                data-testid={`count-${status}`}
              >
                {counts?.[status] ?? "–"}
              </Badge>
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={tab}>
          {error !== null ? <ErrorNotice error={error} /> : null}
          {users === null ? (
            error === null ? (
              <p data-testid="support-loading" className="text-muted-foreground py-6 text-center">
                {t("loading")}
              </p>
            ) : null
          ) : (
            <UserModerationTable users={users} onChanged={() => setReloads((n) => n + 1)} />
          )}
        </TabsContent>
      </Tabs>
    </section>
  );
}

/** spec: ADM-001, ADM-002. Admin-only moderation page, one tab per account status. */
export default function SupportPage() {
  return (
    <AccountGate>
      <SupportGuard>
        <SupportContent />
      </SupportGuard>
    </AccountGate>
  );
}
