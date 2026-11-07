"use client";

import { CalendarDays, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useCallback, useState, type KeyboardEvent } from "react";
import { flushSync } from "react-dom";
import { SlugField } from "@/components/cards/SlugField";
import { ErrorNotice } from "@/components/ErrorNotice";
import { useShellSlots } from "@/components/shell/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useApi, useReframeMedia, useUploadMedia } from "@/lib/api";
import { cardDisplayName } from "@/lib/cards/display-name";
import {
  applyTemplateChange,
  blockingErrors,
  draftFromCard,
  draftToUpdateBody,
  fieldErrors,
  isDirty,
  publicBaseUrlOf,
  type CardDraft,
} from "@/lib/cards/draft";
import { errorFields, type ErrorField } from "@/lib/cards/error-fields";
import { sectionSummary, type EditorSection } from "@/lib/cards/section-summary";
import { useSlugAvailability } from "@/lib/cards/slug-availability";
import { canEdit } from "@/lib/cards/status";
import type { CardView } from "@/lib/cards/types";
import { supportMailto } from "@/lib/instance-links";
import { useLeaveGuard } from "@/lib/leave-guard";
import type { ReframeMedia, UploadMedia } from "@/lib/media/upload";
import { resolveTheme } from "@/lib/theme/resolve";
import { showToast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { getTemplate } from "@/templates/registry";
import { parseSettings } from "@/templates/settings-schema";
import { ContentFields } from "./ContentFields";
import { EditorSectionPanel, EditorSectionTabs, type SectionTab } from "./EditorSections";
import { ErrorSummary } from "./ErrorSummary";
import { FieldMessage } from "./Field";
import { LeaveDialog } from "./LeaveDialog";
import { LinksEditor } from "./LinksEditor";
import { MediaField } from "./MediaField";
import { PhonePreview } from "./PhonePreview";
import { SettingsForm } from "./SettingsForm";
import { TemplatePicker } from "./TemplatePicker";
import { ThemeEditor } from "./ThemeEditor";

type Mode = "edit" | "preview";

const MODES: readonly Mode[] = ["edit", "preview"];
const FORM_ID = "card-editor-form";
const PREVIEW_ID = "card-editor-preview";
/** Hidden on a phone: the view the Modifier / Aperçu tabs do not show. */
const OFF_ON_PHONE = "@max-[847px]:hidden";

const TAB_LOOK =
  "text-app-muted inline-flex min-h-[38px] flex-1 cursor-pointer items-center justify-center rounded-lg px-3.5 text-sm font-semibold aria-selected:bg-app-surface aria-selected:text-app-text aria-selected:shadow-app-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-ring)]";

/**
 * spec: EDI-003 to EDI-007, EDI-015 to EDI-017, EDI-027, LNK-036. On a computer, the form on the left with
 * anchor tabs and the live preview in a phone frame on the right; on a phone, the tabs Modifier / Aperçu,
 * folding sections and a sticky « Enregistrer » bar. Nothing is published before « Enregistrer »; a refused
 * save keeps everything typed, lists the fields to fix and shows each error under its field; leaving with
 * unsaved changes asks first. A card blocked by the support opens read-only.
 */
export function CardEditor({ card }: { card: CardView }) {
  const t = useTranslations();
  const api = useApi();
  const sendMedia = useUploadMedia(card.id);
  const sendReframe = useReframeMedia(card.id);
  const readOnly = !canEdit(card.status);
  // Uploads and re-framings in flight. A save landing meanwhile would delete the new media as unreferenced
  // (MED-018) and leave the draft pointing at a dead media id, so saving waits for them.
  const [uploading, setUploading] = useState(0);
  const inFlight = useCallback(async <T,>(request: () => Promise<T>): Promise<T> => {
    setUploading((count) => count + 1);
    try {
      return await request();
    } finally {
      setUploading((count) => count - 1);
    }
  }, []);
  const uploadMedia = useCallback<UploadMedia>(
    (slot, file, framing) => inFlight(() => sendMedia(slot, file, framing)),
    [inFlight, sendMedia],
  );
  const reframeMedia = useCallback<ReframeMedia>(
    (mediaId, framing) => inFlight(() => sendReframe(mediaId, framing)),
    [inFlight, sendReframe],
  );
  const [saved, setSaved] = useState(() => draftFromCard(card));
  const [draft, setDraft] = useState(saved);
  const [simulateEvent, setSimulateEvent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<Mode>("edit");
  const [tab, setTab] = useState<SectionTab>("identity");
  const [openSections, setOpenSections] = useState<ReadonlySet<EditorSection>>(() => new Set(["identity"]));
  // Field errors of the last save, by path (message keys), and any other failure.
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<unknown>(null);
  const slugCheck = useSlugAvailability(draft.slug, card.id);
  const publicBaseUrl = publicBaseUrlOf(card);
  const dirty = isDirty(saved, draft);
  const slugRefused = ["taken", "reserved", "invalid"].includes(slugCheck.status);
  const canSave = dirty && !busy && uploading === 0 && !slugRefused;
  const refused = errorFields(Object.keys(errors));
  const name = cardDisplayName(saved.content) ?? t("cards.untitled");

  const message = (key: string | undefined) => (key ? (t.has(key) ? t(key) : t("editor.invalid")) : undefined);
  const messages = Object.fromEntries(Object.entries(errors).map(([path, key]) => [path, message(key)!]));

  /** Applies an edit; the messages of the fields it corrects go away. A read-only card takes none. */
  function edit(patch: Partial<CardDraft>, fixed: string[]) {
    if (readOnly) return;
    setDraft((current) => ({ ...current, ...patch }));
    if (fixed.some((path) => Object.hasOwn(errors, path))) {
      setErrors((current) => Object.fromEntries(Object.entries(current).filter(([path]) => !fixed.includes(path))));
    }
  }

  function toggleSection(section: EditorSection) {
    setOpenSections((current) => {
      const next = new Set(current);
      if (!next.delete(section)) next.add(section);
      return next;
    });
  }

  /** Brings a refused field into view, unfolding its section on a phone, and gives it the focus. */
  function jump(field: ErrorField) {
    flushSync(() => {
      setMode("edit");
      setOpenSections((current) => new Set([...current, field.section]));
    });
    document.getElementById(field.targetId)?.focus();
  }

  /** Shows the refused fields, unfolding the sections that hold them on a phone. */
  function refuse(fields: Record<string, string>) {
    setErrors(fields);
    const sections = errorFields(Object.keys(fields)).map((field) => field.section);
    setOpenSections((current) => new Set([...current, ...sections]));
  }

  /** Saves the draft; tells whether the card is now stored (a refused or failed save keeps the editor open). */
  async function save(): Promise<boolean> {
    if (!canSave) return false;
    // TPL-013: a theme failing a contrast check is not sent; the summary points at it.
    const blocked = blockingErrors(draft);
    if (Object.keys(blocked).length > 0) {
      refuse(blocked);
      return false;
    }
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
      showToast(t("editor.savedToast"));
      return true;
    } catch (error) {
      const refusedFields = fieldErrors(error);
      refuse(refusedFields);
      if (Object.keys(refusedFields).length === 0) setFailure(error);
      return false;
    } finally {
      setBusy(false);
    }
  }

  // EDI-016, EDI-028: the browser asks before closing or reloading; a link of the page opens the leave dialog.
  const leaveGuard = useLeaveGuard({ dirty, save });

  function selectMode(next: Mode) {
    setMode(next);
    document.getElementById(`card-editor-mode-${next}`)?.focus();
  }

  function onModeKey(event: KeyboardEvent) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    selectMode(mode === "edit" ? "preview" : "edit");
  }

  const saveLabel = busy ? t("editor.saving") : t("editor.save");
  const unsavedBadge = dirty ? <Badge variant="warning">{t("editor.unsaved")}</Badge> : null;

  useShellSlots({
    fullBleed: true,
    title: name,
    breadcrumb: [{ label: t("shell.cards"), href: "/dashboard", testId: "editor-back" }, { label: name }],
    breadcrumbTail: (
      <span data-testid="editor-slug" className="font-app-mono ml-1.5 truncate text-[13px]">
        /c/{saved.slug}
      </span>
    ),
    action: (
      <Link
        href={`/dashboard/cards/${card.id}/events`}
        data-testid="editor-events-bar"
        aria-label={t("editor.events")}
        className="rounded-app grid size-11 flex-none place-items-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-ring)]"
      >
        <CalendarDays aria-hidden="true" className="size-5" />
      </Link>
    ),
    topBarActions: (
      <>
        <p data-testid="editor-status" role="status" className="contents">
          {unsavedBadge}
        </p>
        {refused.length > 0 ? (
          <Badge variant="danger" data-testid="editor-error-count">
            {t("editor.errorCount", { count: refused.length })}
          </Badge>
        ) : null}
        <Button variant="secondary" asChild>
          <Link href={`/dashboard/cards/${card.id}/events`} data-testid="editor-events">
            {t("editor.events")}
          </Link>
        </Button>
        <Button variant="secondary" asChild>
          <a href={card.public_url} target="_blank" rel="noreferrer" data-testid="editor-public-page">
            {t("editor.publicPage")}
            <ExternalLink aria-hidden="true" />
          </a>
        </Button>
        {readOnly ? null : (
          <Button type="button" data-testid="editor-save" disabled={!canSave} onClick={() => void save()}>
            {saveLabel}
          </Button>
        )}
      </>
    ),
    saveBar: readOnly ? undefined : (
      <div className="px-4 pt-3 pb-5">
        <Button
          type="button"
          className="w-full"
          data-testid="editor-save-bar"
          disabled={!canSave}
          onClick={() => void save()}
        >
          {saveLabel}
        </Button>
      </div>
    ),
  });

  const template = getTemplate(draft.template);
  const settings = parseSettings(template.settings, draft.settings);
  const mediaErrors = ["header_media_id", "avatar_media_id"] as const;
  const summary = (section: EditorSection) => sectionSummary(section, draft, (key, values) => t(key, values));
  const panel = (section: EditorSection) => ({
    section,
    title: t(`editor.sections.${section}`),
    summary: summary(section),
    open: openSections.has(section),
    onToggle: () => toggleSection(section),
    readOnly,
  });

  return (
    <div
      data-testid="card-editor"
      className="grid flex-1 grid-cols-1 @min-[848px]:grid-cols-[minmax(0,1fr)_440px]"
    >
      <h1 className="sr-only">{t("editor.title")}</h1>
      <LeaveDialog
        guard={leaveGuard}
        canSave={canSave}
        description={t("editor.leave.body", { name })}
        phoneDescription={t("editor.leave.bodyPhone")}
      />

      <div className="bg-app-surface border-app-border flex flex-col gap-2.5 border-b px-4 py-3 @min-[848px]:hidden">
        <div role="tablist" aria-label={t("editor.modes.label")} className="bg-app-surface-2 rounded-app flex gap-0.5 p-[3px]">
          {MODES.map((value) => (
            <button
              key={value}
              id={`card-editor-mode-${value}`}
              type="button"
              role="tab"
              aria-selected={mode === value}
              aria-controls={value === "edit" ? FORM_ID : PREVIEW_ID}
              tabIndex={mode === value ? 0 : -1}
              onClick={() => setMode(value)}
              onKeyDown={onModeKey}
              className={TAB_LOOK}
            >
              {t(`editor.modes.${value}`)}
            </button>
          ))}
        </div>
        <p data-testid="editor-status-phone" role="status" className="contents">
          {mode === "edit" ? unsavedBadge : null}
        </p>
      </div>

      <form
        id={FORM_ID}
        aria-label={t("editor.formLabel")}
        noValidate
        className={cn(
          "flex min-w-0 flex-col @min-[848px]:gap-5 @min-[848px]:px-10 @min-[848px]:pt-6 @min-[848px]:pb-12",
          mode === "preview" && OFF_ON_PHONE,
        )}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <EditorSectionTabs current={tab} onSelect={setTab} />

        {readOnly ? (
          <div
            data-testid="editor-blocked"
            className="bg-app-warning-soft rounded-app m-4 flex flex-col gap-1 px-4 py-3.5 text-sm leading-[1.45] @min-[848px]:m-0"
          >
            <b>{t("editor.blocked.title")}</b>
            <p>{t("editor.blocked.description")}</p>
            <a href={supportMailto()} className="self-start font-semibold underline">
              {t("editor.blocked.support")}
            </a>
          </div>
        ) : null}
        {refused.length > 0 ? (
          <div className="m-4 @min-[848px]:m-0">
            <ErrorSummary fields={refused} onJump={jump} />
          </div>
        ) : null}
        {failure !== null ? (
          <div className="m-4 @min-[848px]:m-0">
            <ErrorNotice error={failure} />
          </div>
        ) : null}

        <EditorSectionPanel {...panel("identity")}>
          <SlugField
            value={draft.slug}
            status={slugCheck.status}
            suggestions={slugCheck.suggestions}
            error={messages.slug}
            onChange={(slug) => edit({ slug }, ["slug"])}
          />
          <ContentFields
            fields={["first_name", "last_name", "job_title", "company", "description"]}
            value={draft.content}
            errors={messages}
            onChange={(field, text) => edit({ content: { ...draft.content, [field]: text } }, [`content.${field}`])}
          />
        </EditorSectionPanel>

        <EditorSectionPanel {...panel("contact")}>
          <ContentFields
            fields={["email", "phone"]}
            value={draft.content}
            errors={messages}
            onChange={(field, text) => edit({ content: { ...draft.content, [field]: text } }, [`content.${field}`])}
          />
        </EditorSectionPanel>

        <EditorSectionPanel {...panel("links")}>
          <LinksEditor value={draft.links} errors={messages} onChange={(links, fixed) => edit({ links }, fixed)} />
        </EditorSectionPanel>

        <EditorSectionPanel {...panel("media")}>
          <div data-testid="media-slot" className="space-y-4">
            <MediaField
              media={template.media}
              header={draft.header}
              avatar={draft.avatar}
              upload={uploadMedia}
              reframe={reframeMedia}
              theme={resolveTheme(draft.theme)}
              name={cardDisplayName(draft.content)}
              onChange={(slot, media) => edit({ [slot]: media }, [`${slot}_media_id`])}
            />
            {mediaErrors.map((path) => (
              <FieldMessage key={path} path={path} message={messages[path]} />
            ))}
          </div>
        </EditorSectionPanel>

        <EditorSectionPanel {...panel("template")}>
          <TemplatePicker
            value={draft.template}
            theme={draft.theme}
            onChange={(id) => {
              const next = applyTemplateChange(draft, id);
              edit({ template: next.template, settings: next.settings }, ["template", "settings"]);
            }}
          />
          <FieldMessage path="template" message={messages.template} />
          {template.settings.fields.length === 0 ? (
            <p className="text-app-muted text-sm">{t("editor.settings.none")}</p>
          ) : (
            <SettingsForm
              schema={template.settings}
              value={settings}
              templateName={t(template.nameKey)}
              disabled={readOnly}
              onChange={(key, value) => edit({ settings: { ...settings, [key]: value } }, ["settings"])}
            />
          )}
          <FieldMessage path="settings" message={messages.settings} />
        </EditorSectionPanel>

        <EditorSectionPanel {...panel("theme")} note={summary("theme")}>
          <ThemeEditor
            theme={draft.theme}
            error={messages.theme}
            disabled={readOnly}
            onChange={(theme) => edit({ theme }, ["theme"])}
          />
        </EditorSectionPanel>
      </form>

      <section
        id={PREVIEW_ID}
        aria-label={t("editor.preview.title")}
        data-testid="editor-preview"
        className={cn(
          "bg-app-surface-2 border-app-border min-w-0 @min-[848px]:border-l",
          mode === "edit" && OFF_ON_PHONE,
        )}
      >
        <div className="flex flex-col items-center gap-3.5 px-4 py-5 @min-[848px]:sticky @min-[848px]:top-0 @min-[848px]:px-8 @min-[848px]:py-6">
          <div className="hidden w-full items-center justify-between gap-3 @min-[848px]:flex">
            <h2 className="text-base leading-[1.35] font-semibold">{t("editor.preview.heading")}</h2>
            <Badge variant="neutral">{t("editor.preview.draft")}</Badge>
          </div>
          <div className="bg-app-surface border-app-border flex min-h-11 items-center justify-between gap-3 self-stretch rounded-xl border pr-2 pl-3.5">
            <Label htmlFor="simulate-event" className="text-[15px] font-semibold">
              {t("editor.preview.simulateEvent")}
            </Label>
            <Switch
              id="simulate-event"
              data-testid="simulate-event"
              checked={simulateEvent}
              onCheckedChange={setSimulateEvent}
            />
          </div>
          <PhonePreview draft={draft} simulateEvent={simulateEvent} publicBaseUrl={publicBaseUrl} />
          <p className="text-app-muted text-center text-[13px] leading-[1.4]">{t("editor.preview.note")}</p>
        </div>
      </section>
    </div>
  );
}
