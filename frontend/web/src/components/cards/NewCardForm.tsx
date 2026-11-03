"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ErrorNotice } from "@/components/ErrorNotice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApi } from "@/lib/api";
import { useSlugAvailability } from "@/lib/cards/slug-availability";
import { useSlugSuggestion } from "@/lib/cards/slug-suggestion";
import { SlugField } from "./SlugField";

/**
 * spec: EDI-013, LNK-001, LNK-019, LNK-020. First and last name, then the proposed slug (editable);
 * creating the card opens it in the editor.
 */
export function NewCardForm() {
  const t = useTranslations("cards.new");
  const api = useApi();
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  // The slug the user typed; until then the proposal follows the name.
  const [typedSlug, setTypedSlug] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const suggestion = useSlugSuggestion(firstName, lastName);
  const slug = typedSlug ?? suggestion ?? "";
  const { status } = useSlugAvailability(slug);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.POST("/api/cards", {
        body: { first_name: firstName.trim() || null, last_name: lastName.trim() || null, slug: slug.trim() },
      });
      if (!data) throw new Error("empty response");
      router.push(`/dashboard/cards/${data.id}`);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <form
      className="mx-auto max-w-md space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        if (status === "free" && !busy) void create();
      }}
    >
      <h1 className="text-3xl font-bold tracking-tight">{t("title")}</h1>
      <div className="space-y-2">
        <Label htmlFor="new-card-first-name">{t("firstName")}</Label>
        <Input
          id="new-card-first-name"
          data-testid="new-card-first-name"
          value={firstName}
          autoComplete="off"
          onChange={(event) => setFirstName(event.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="new-card-last-name">{t("lastName")}</Label>
        <Input
          id="new-card-last-name"
          data-testid="new-card-last-name"
          value={lastName}
          autoComplete="off"
          onChange={(event) => setLastName(event.target.value)}
        />
      </div>
      <SlugField value={slug} onChange={setTypedSlug} status={status} />
      {error !== null ? <ErrorNotice error={error} /> : null}
      <div className="flex items-center justify-between gap-4">
        <Link href="/dashboard" className="text-sm underline" data-testid="new-card-back">
          {t("back")}
        </Link>
        <Button type="submit" data-testid="new-card-submit" disabled={busy || status !== "free"}>
          {t("submit")}
        </Button>
      </div>
    </form>
  );
}
