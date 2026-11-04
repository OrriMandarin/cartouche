"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LeaveDialog } from "@/components/editor/LeaveDialog";
import { describedBy, FieldMessage } from "@/components/editor/Field";
import { ErrorNotice } from "@/components/ErrorNotice";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useApi } from "@/lib/api";
import type { CardView } from "@/lib/cards/types";
import {
  type EventDraft,
  clearErrors,
  draftFromEvent,
  draftToBody,
  enableEnd,
  eventFieldErrors,
  isEventDraftDirty,
  newEventDraft,
} from "@/lib/events/draft";
import { eventErrorKey } from "@/lib/events/errors";
import { userTimeZone, zoneLabel } from "@/lib/events/time";
import type { EventView } from "@/lib/events/types";
import { useLeaveGuard } from "@/lib/leave-guard";
import { ConsentEditor } from "./ConsentEditor";
import { CustomFieldsEditor } from "./CustomFieldsEditor";
import { StandardFieldsEditor } from "./StandardFieldsEditor";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/**
 * spec: EDI-019, EDI-015, EDI-021, EVT-001, EVT-009, EVT-018, EVT-022. Creates an event of the card, or edits
 * `event`. A refused save keeps everything typed and shows each error under its field; a card already at its
 * limit of simultaneous events is explained at the top of the form. Leaving with unsaved changes asks first.
 */
export function EventEditor({ cardId, card, event }: { cardId: string; card: CardView; event?: EventView }) {
  const t = useTranslations();
  const api = useApi();
  const router = useRouter();
  const [zone] = useState(userTimeZone);
  const [saved, setSaved] = useState(() => (event ? draftFromEvent(event, zone) : newEventDraft(zone, new Date())));
  const [draft, setDraft] = useState(saved);
  const [busy, setBusy] = useState(false);
  // Field errors of the last save, by path (message keys), and any other failure.
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<unknown>(null);
  const listHref = `/dashboard/cards/${cardId}/events`;
  const dirty = isEventDraftDirty(saved, draft);

  const message = (key: string | undefined) => (key ? (t.has(key) ? t(key) : t("events.editor.invalid")) : undefined);
  const messages = Object.fromEntries(Object.entries(errors).map(([path, key]) => [path, message(key)!]));
  const failureKey = eventErrorKey(failure);

  /** Applies an edit; the messages of the fields it corrects go away. */
  function edit(next: EventDraft, fixed: string[]) {
    setDraft(next);
    setErrors((current) => clearErrors(current, fixed));
  }

  /** Stores the event; tells whether it is stored (a refused or failed save keeps the editor open). */
  async function persist(): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setFailure(null);
    setErrors({});
    try {
      const sent = draft;
      const body = draftToBody(sent, zone);
      if (event) {
        await api.PUT("/api/events/{id}", { params: { path: { id: event.id } }, body });
      } else {
        await api.POST("/api/cards/{id}/events", { params: { path: { id: cardId } }, body });
      }
      // What was sent is now the reference (EDI-021).
      setSaved(sent);
      // The button stays disabled until the page changes: a second click cannot create a second event.
      return true;
    } catch (error) {
      const refused = eventFieldErrors(error);
      setErrors(refused);
      if (Object.keys(refused).length === 0) setFailure(error);
      setBusy(false);
      return false;
    }
  }

  async function save() {
    if (await persist()) router.push(listHref);
  }

  // EDI-016, EDI-028: the browser asks before closing or reloading; a link of the page opens the leave dialog.
  const leaveGuard = useLeaveGuard({ dirty, save: persist });

  const noEnd = draft.endsAt === "";
  const field = (path: string) => ({
    "aria-invalid": messages[path] ? (true as const) : undefined,
    "aria-describedby": describedBy(path, messages[path]),
  });

  return (
    <form
      aria-label={t("events.editor.formLabel")}
      noValidate
      data-testid="event-editor"
      className="max-w-2xl min-w-0 space-y-8"
      onSubmit={(submitted) => {
        submitted.preventDefault();
        void save();
      }}
    >
      <LeaveDialog
        guard={leaveGuard}
        description={t("events.editor.leave.body", {
          title: draft.title.trim() || saved.title.trim() || t("events.editor.leave.untitled"),
        })}
      />
      <div className="bg-background/95 sticky top-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-3 border-b px-1 py-3 backdrop-blur">
        <Link href={listHref} data-testid="event-back" className="text-sm underline">
          {t("events.backToEvents")}
        </Link>
        <div className="flex items-center gap-3">
          <p data-testid="event-status" role="status" className="text-muted-foreground text-sm">
            {dirty ? t("events.editor.unsaved") : null}
          </p>
          <Button type="submit" data-testid="event-save" disabled={busy}>
            {busy ? t("events.editor.saving") : t("events.editor.save")}
          </Button>
        </div>
      </div>

      <h1 className="text-3xl font-bold tracking-tight">
        {event ? t("events.editor.titleEdit") : t("events.editor.titleNew")}
      </h1>

      {Object.keys(errors).length > 0 ? (
        <Alert variant="destructive" data-testid="event-error-summary">
          <AlertDescription>{t("events.editor.invalid")}</AlertDescription>
        </Alert>
      ) : null}
      {failureKey !== null ? (
        <Alert variant="destructive" data-testid="event-conflict">
          <AlertDescription>{t(failureKey)}</AlertDescription>
        </Alert>
      ) : failure !== null ? (
        <ErrorNotice error={failure} />
      ) : null}

      <Section title={t("events.editor.sections.general")}>
        <div className="space-y-2">
          <Label htmlFor="event-title">{t("events.editor.name")}</Label>
          <Input
            id="event-title"
            data-testid="event-title"
            autoComplete="off"
            value={draft.title}
            {...field("title")}
            onChange={(e) => edit({ ...draft, title: e.target.value }, ["title"])}
          />
          <FieldMessage path="title" message={messages.title} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="event-description">{t("events.editor.description")}</Label>
          <Textarea
            id="event-description"
            data-testid="event-description"
            rows={4}
            value={draft.description}
            {...field("description")}
            onChange={(e) => edit({ ...draft, description: e.target.value }, ["description"])}
          />
          <FieldMessage path="description" message={messages.description} />
        </div>
      </Section>

      <Section title={t("events.editor.sections.dates")}>
        <p data-testid="event-zone" className="text-muted-foreground text-sm">
          {t("events.editor.zone", { zone: zoneLabel(zone) })}
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="event-starts-at">{t("events.editor.startsAt")}</Label>
            <Input
              id="event-starts-at"
              data-testid="event-starts-at"
              type="datetime-local"
              value={draft.startsAt}
              {...field("starts_at")}
              onChange={(e) => edit({ ...draft, startsAt: e.target.value }, ["starts_at", "ends_at"])}
            />
            <FieldMessage path="starts_at" message={messages.starts_at} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="event-ends-at">{t("events.editor.endsAt")}</Label>
            <Input
              id="event-ends-at"
              data-testid="event-ends-at"
              type="datetime-local"
              value={draft.endsAt}
              {...field("ends_at")}
              onChange={(e) => edit({ ...draft, endsAt: e.target.value }, ["ends_at"])}
            />
            <div className="flex items-center gap-3">
              <Switch
                id="event-no-end"
                data-testid="event-no-end"
                checked={noEnd}
                onCheckedChange={(checked) =>
                  edit(checked ? { ...draft, endsAt: "" } : enableEnd(draft, zone), ["ends_at"])
                }
              />
              <Label htmlFor="event-no-end">{t("events.editor.noEnd")}</Label>
            </div>
            <FieldMessage path="ends_at" message={messages.ends_at} />
          </div>
        </div>
      </Section>

      <Section title={t("events.editor.sections.access")}>
        <div className="space-y-2">
          <Label htmlFor="event-access-code">{t("events.editor.accessCode")}</Label>
          <Input
            id="event-access-code"
            data-testid="event-access-code"
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={draft.accessCode}
            {...field("access_code")}
            onChange={(e) => edit({ ...draft, accessCode: e.target.value }, ["access_code"])}
          />
          <p className="text-muted-foreground text-sm">{t("events.editor.accessCodeHint")}</p>
          <FieldMessage path="access_code" message={messages.access_code} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="event-device-limit">{t("events.editor.deviceLimit")}</Label>
          <Input
            id="event-device-limit"
            data-testid="event-device-limit"
            type="number"
            inputMode="numeric"
            min={1}
            max={100}
            value={draft.deviceLimit}
            {...field("device_limit")}
            onChange={(e) => edit({ ...draft, deviceLimit: e.target.value }, ["device_limit"])}
          />
          <p className="text-muted-foreground text-sm">{t("events.editor.deviceLimitHint")}</p>
          <FieldMessage path="device_limit" message={messages.device_limit} />
        </div>
      </Section>

      <Section title={t("events.editor.sections.standardFields")}>
        <StandardFieldsEditor
          value={draft.standardFields}
          error={messages.standard_fields}
          onChange={(name, mode) =>
            edit({ ...draft, standardFields: { ...draft.standardFields, [name]: mode } }, ["standard_fields"])
          }
        />
      </Section>

      <Section title={t("events.editor.sections.customFields")}>
        <CustomFieldsEditor draft={draft} errors={messages} onChange={edit} />
      </Section>

      <Section title={t("events.editor.sections.consent")}>
        <ConsentEditor
          cardId={cardId}
          card={card}
          draft={draft}
          error={messages.consent_text}
          {...(event ? { knownDefault: { title: event.title, text: event.default_consent_text } } : {})}
          onChange={(patch) => edit({ ...draft, ...patch }, ["consent_text"])}
        />
      </Section>
    </form>
  );
}
