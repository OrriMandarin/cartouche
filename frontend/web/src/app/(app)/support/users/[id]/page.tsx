"use client";

import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useCallback } from "react";
import { AccountGate } from "@/components/account/AccountGate";
import { SupportGuard } from "@/components/support/SupportGuard";
import { SupportLoader } from "@/components/support/SupportLoader";
import { SupportTitle } from "@/components/support/SupportTitle";
import { UserCards } from "@/components/support/UserCards";
import { useSupportSlots } from "@/components/support/useSupportSlots";
import { useApi } from "@/lib/api";

function UserContent({ id }: { id: string }) {
  const t = useTranslations("support");
  const api = useApi();
  const load = useCallback(async () => {
    const { data } = await api.GET("/api/admin/users/{id}", { params: { path: { id } } });
    if (!data) throw new Error("empty response");
    return data;
  }, [api, id]);

  return (
    <section className="space-y-6">
      <SupportTitle>{t("title")}</SupportTitle>
      <SupportLoader load={load} notFound={t("cards.userNotFound")}>
        {({ user, cards }) => <UserCards user={user} cards={cards} />}
      </SupportLoader>
    </section>
  );
}

/** spec: ADM-006, ADM-013. Admin-only: an account's profile and its cards. */
export default function SupportUserPage() {
  const { id } = useParams<{ id: string }>();
  const slots = useSupportSlots({ kind: "user" });
  return (
    <AccountGate {...slots}>
      <SupportGuard>
        <UserContent id={id} />
      </SupportGuard>
    </AccountGate>
  );
}
