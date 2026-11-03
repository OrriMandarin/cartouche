"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useState } from "react";
import { SlugField } from "@/components/cards/SlugField";
import { ErrorNotice } from "@/components/ErrorNotice";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useApi } from "@/lib/api";
import {
  draftFromCard,
  draftToUpdateBody,
  fieldErrors,
  isDirty,
  publicBaseUrlOf,
  type CardDraft,
} from "@/lib/cards/draft";
import { useSlugAvailability } from "@/lib/cards/slug-availability";
import type { CardView } from "@/lib/cards/types";
import { getTemplate } from "@/templates/registry";
import { parseSettings } from "@/templates/settings-schema";
import { ContentFields } from "./ContentFields";
import { FieldMessage } from "./Field";
import { LinksEditor } from "./LinksEditor";
import { PhonePreview } from "./PhonePreview";
import { SettingsForm } from "./SettingsForm";
import { TemplatePicker } from "./TemplatePicker";
import { ThemeEditor } from "./ThemeEditor";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/**
 * spec: EDI-003 to EDI-007, EDI-015 to EDI-017. The form on the left, the live preview in a phone frame on the
 * right. Nothing is published before « Enregistrer »; a refused save keeps everything typed and shows each
 * error under its field; leaving with unsaved changes asks first.
 */
export function CardEditor({ card }: { card: CardView }) {
  const t = useTranslations();
  const api = useApi();
  const [saved, setSaved] = useState(() => draftFromCard(card));
  const [draft, setDraft] = useState(saved);
  const [simulateEvent, setSimulateEvent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  // Field errors of the last save, by path (message keys), and any other failure.
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<unknown>(null);
  const slugCheck = useSlugAvailability(draft.slug, card.id);
  const publicBaseUrl = publicBaseUrlOf(card);
  const dirty = isDirty(saved, draft);
  const slugRefused = ["taken", "reserved", "invalid"].includes(slugCheck.status);

  // EDI-016: the browser asks before closing, reloading or leaving the site.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const message = (key: string | undefined) => (key ? (t.has(key) ? t(key) : t("editor.invalid")) : undefined);
  const messages = Object.fromEntries(Object.entries(errors).map(([path, key]) => [path, message(key)!]));

  /** Applies an edit; the messages of the fields it corrects go away. */
  function edit(patch: Partial<CardDraft>, fixed: string[]) {
    setDraft((current) => ({ ...current, ...patch }));
    setJustSaved(false);
    if (fixed.some((path) => Object.hasOwn(errors, path))) {
      setErrors((current) => Object.fromEntries(Object.entries(current).filter(([path]) => !fixed.includes(path))));
    }
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    setErrors({});
    const sent = draft;
    try {
      const { data } = await api.PUT("/api/cards/{id}", {
        params: { path: { id: card.id } },
        body: draftToUpdateBody(sent),
      });
      if (!data) throw new Error("empty response");
      const stored = draftFromCard(data);
      setSaved(stored);
      // What the server stored (normalized) replaces the draft, unless the owner kept typing meanwhile.
      setDraft((current) => (isDirty(sent, current) ? current : stored));
      setJustSaved(true);
    } catch (error) {
      const refused = fieldErrors(error);
      setErrors(refused);
      if (Object.keys(refused).length === 0) setFailure(error);
    } finally {
      setBusy(false);
    }
  }

  const template = getTemplate(draft.template);
  const settings = parseSettings(template.settings, draft.settings);
  const mediaErrors = ["header_media_id", "avatar_media_id"] as const;

  return (
    <div className="grid gap-8 lg:grid-cols-2" data-testid="card-editor">
      <form
        aria-label={t("editor.formLabel")}
        noValidate
        className="min-w-0 space-y-8"
        onSubmit={(event) => {
          event.preventDefault();
          if (!slugRefused) void save();
        }}
      >
        <div className="bg-background/95 sticky top-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-3 border-b px-1 py-3 backdrop-blur">
          <Link
            href="/dashboard"
            data-testid="editor-back"
            className="text-sm underline"
            onClick={(event) => {
              if (dirty && !window.confirm(t("editor.leaveConfirm"))) event.preventDefault();
            }}
          >
            {t("editor.back")}
          </Link>
          <div className="flex items-center gap-3">
            <p data-testid="editor-status" role="status" className="text-muted-foreground text-sm">
              {dirty ? t("editor.unsaved") : justSaved ? t("editor.saved") : null}
            </p>
            <Button type="submit" data-testid="editor-save" disabled={busy || !dirty || slugRefused}>
              {busy ? t("editor.saving") : t("editor.save")}
            </Button>
          </div>
        </div>

        <h1 className="text-3xl font-bold tracking-tight">{t("editor.title")}</h1>

        {Object.keys(errors).length > 0 ? (
          <Alert variant="destructive" data-testid="editor-error-summary">
            <AlertDescription>{t("editor.invalid")}</AlertDescription>
          </Alert>
        ) : null}
        {failure !== null ? <ErrorNotice error={failure} /> : null}

        <Section title={t("editor.sections.identity")}>
          <SlugField
            value={draft.slug}
            status={slugCheck.status}
            error={messages.slug}
            onChange={(slug) => edit({ slug }, ["slug"])}
          />
          <ContentFields
            value={draft.content}
            errors={messages}
            onChange={(field, text) =>
              edit({ content: { ...draft.content, [field]: text } }, [`content.${field}`])
            }
          />
        </Section>

        <Section title={t("editor.sections.links")}>
          <LinksEditor
            value={draft.links}
            errors={messages}
            onChange={(links, fixed) => edit({ links }, fixed)}
          />
        </Section>

        <Section title={t("editor.sections.media")}>
          {/* Upload of the header and the profile photo: task 18. The draft keeps the card's media as they are. */}
          <div data-testid="media-slot" className="space-y-2">
            <p className="text-muted-foreground text-sm">{t("editor.media.soon")}</p>
            {mediaErrors.map((path) => (
              <FieldMessage key={path} path={path} message={messages[path]} />
            ))}
          </div>
        </Section>

        <Section title={t("editor.sections.template")}>
          <TemplatePicker
            value={draft.template}
            onChange={(id) => edit({ template: id, settings: {} }, ["template", "settings"])}
          />
          <FieldMessage path="template" message={messages.template} />
        </Section>

        <Section title={t("editor.sections.settings")}>
          {template.settings.fields.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("editor.settings.none")}</p>
          ) : (
            <SettingsForm
              schema={template.settings}
              value={settings}
              onChange={(key, value) => edit({ settings: { ...settings, [key]: value } }, ["settings"])}
            />
          )}
          <FieldMessage path="settings" message={messages.settings} />
        </Section>

        <Section title={t("editor.sections.theme")}>
          <ThemeEditor theme={draft.theme} error={messages.theme} onChange={(theme) => edit({ theme }, ["theme"])} />
        </Section>
      </form>

      <section
        aria-label={t("editor.preview.title")}
        data-testid="editor-preview"
        className="min-w-0 space-y-4 lg:sticky lg:top-4 lg:self-start"
      >
        <div className="flex items-center justify-center gap-3">
          <Switch
            id="simulate-event"
            data-testid="simulate-event"
            checked={simulateEvent}
            onCheckedChange={setSimulateEvent}
          />
          <Label htmlFor="simulate-event">{t("editor.preview.simulateEvent")}</Label>
        </div>
        <PhonePreview draft={draft} simulateEvent={simulateEvent} publicBaseUrl={publicBaseUrl} />
      </section>
    </div>
  );
}
