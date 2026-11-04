"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { ErrorNotice } from "@/components/ErrorNotice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApi } from "@/lib/api";
import { useSlugAvailability } from "@/lib/cards/slug-availability";
import { useSlugSuggestion } from "@/lib/cards/slug-suggestion";
import { SlugField } from "./SlugField";

/**
 * spec: EDI-013, EDI-025, LNK-001, LNK-019, LNK-020, LNK-035. First and last name, then the proposed slug (editable);
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
  const { status, suggestions } = useSlugAvailability(slug);
  // The address the card will be served from; known in the browser only.
  const host = useSyncExternalStore(
    () => () => undefined,
    () => window.location.host,
    () => "",
  );

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
      className="bg-app-surface border-app-border rounded-app-lg shadow-app-sm mx-auto flex w-full max-w-[620px] flex-col gap-[22px] border p-5 @min-[848px]:p-8"
      onSubmit={(event) => {
        event.preventDefault();
        if (status === "free" && !busy) void create();
      }}
    >
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-bold tracking-tight @max-[847px]:sr-only">{t("title")}</h1>
        <p className="text-app-muted text-[15px]">{t("subtitle")}</p>
      </div>
      <div className="grid grid-cols-1 gap-4 @min-[560px]:grid-cols-2">
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
      </div>
      <SlugField
        value={slug}
        onChange={setTypedSlug}
        status={status}
        suggestions={suggestions}
        prefix={
          <>
            <span className="@max-[847px]:hidden">{host}/c/</span>
            <span className="@min-[848px]:hidden">…/c/</span>
          </>
        }
        hint={
          <>
            <span className="@max-[847px]:hidden">{t("slugHint")}</span>
            <span className="@min-[848px]:hidden">{t("slugHintShort")}</span>
          </>
        }
      />
      {error !== null ? <ErrorNotice error={error} /> : null}
      <div className="border-app-border flex flex-col-reverse gap-2.5 border-t pt-4 @min-[560px]:flex-row @min-[560px]:justify-end">
        <Button asChild variant="secondary">
          <Link href="/dashboard" data-testid="new-card-back">
            {t("cancel")}
          </Link>
        </Button>
        <Button type="submit" data-testid="new-card-submit" disabled={busy || status !== "free"}>
          {t("submit")}
        </Button>
      </div>
    </form>
  );
}
