"use client";

import type { components } from "@cartouche/api-client";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useState } from "react";
import { ErrorNotice } from "@/components/ErrorNotice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useApi } from "@/lib/api";
import { allowedTargets, type UserStatus } from "@/lib/moderation";

export type ModerationUser = components["schemas"]["AdminUserView"];

const dateFormat = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" });

export const STATUS_VARIANT = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  suspended: "neutral",
} as const;

function actionKey(from: UserStatus, to: UserStatus): "approve" | "reject" | "suspend" | "reactivate" {
  if (to === "rejected") return "reject";
  if (to === "suspended") return "suspend";
  return from === "pending" ? "approve" : "reactivate";
}

/** spec: ADM-002, ADM-003, ADM-004. One row per account, with the moderation actions the server would accept. */
export function UserModerationTable({
  users,
  onChanged,
}: {
  users: ModerationUser[];
  /** Called after a successful status change, to reload the list and the counters. */
  onChanged: () => void | Promise<void>;
}) {
  const t = useTranslations("support");
  const api = useApi();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function setStatus(user: ModerationUser, status: UserStatus) {
    setBusy(user.id);
    setError(null);
    try {
      await api.POST("/api/admin/users/{id}/status", {
        params: { path: { id: user.id } },
        body: { status },
      });
    } catch (e) {
      setError(e);
      setBusy(null);
      return;
    }
    try {
      await onChanged();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {error !== null ? <ErrorNotice error={error} /> : null}
      {users.length === 0 ? (
        <p data-testid="support-empty" className="text-app-muted rounded-app-lg border border-dashed p-4 text-sm">
          {t("empty")}
        </p>
      ) : (
        <div className="bg-app-surface border-app-border rounded-app-lg shadow-app-sm overflow-hidden border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.name")}</TableHead>
                <TableHead>{t("columns.email")}</TableHead>
                <TableHead className="hidden @min-[848px]:table-cell">{t("columns.subject")}</TableHead>
                <TableHead>{t("columns.status")}</TableHead>
                <TableHead className="hidden @min-[848px]:table-cell">{t("columns.createdAt")}</TableHead>
                <TableHead>{t("columns.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id} data-testid={`user-row-${user.subject}`}>
                  <TableCell>
                    <Link
                      href={`/support/users/${user.id}`}
                      data-testid={`user-link-${user.subject}`}
                      className="focus-visible:outline-app-ring font-semibold underline underline-offset-3 focus-visible:outline-2 focus-visible:outline-offset-2"
                    >
                      <span data-testid={`user-name-${user.subject}`}>
                        {user.display_name || user.email || user.subject}
                      </span>
                    </Link>
                    {user.is_admin ? (
                      <Badge variant="info" className="ml-2" data-testid={`admin-badge-${user.subject}`}>
                        {t("admin")}
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell className="text-app-muted hidden font-mono text-xs @min-[848px]:table-cell">{user.subject}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[user.status]}>{t(`status.${user.status}`)}</Badge>
                  </TableCell>
                  <TableCell className="hidden @min-[848px]:table-cell">{dateFormat.format(new Date(user.created_at))}</TableCell>
                  <TableCell>
                    {user.is_admin ? null : (
                      <div className="flex gap-2">
                        {allowedTargets(user.status).map((target) => (
                          <Button
                            key={target}
                            size="sm"
                            variant={target === "approved" ? "default" : "secondary"}
                            disabled={busy !== null}
                            data-testid={`set-status-${user.subject}-${target}`}
                            onClick={() => void setStatus(user, target)}
                          >
                            {t(`actions.${actionKey(user.status, target)}`)}
                          </Button>
                        ))}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
