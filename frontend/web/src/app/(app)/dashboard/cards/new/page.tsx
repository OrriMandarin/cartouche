"use client";

import { useTranslations } from "next-intl";
import { AccountGate } from "@/components/account/AccountGate";
import { NewCardForm } from "@/components/cards/NewCardForm";

/** spec: EDI-013. Creation of a card: name, then slug. */
export default function NewCardPage() {
  const t = useTranslations("shell");
  return (
    <AccountGate
      title={t("newCard")}
      breadcrumb={[{ label: t("cards"), href: "/dashboard" }, { label: t("newCard") }]}
      back={{ href: "/dashboard", label: t("cards") }}
    >
      <NewCardForm />
    </AccountGate>
  );
}
