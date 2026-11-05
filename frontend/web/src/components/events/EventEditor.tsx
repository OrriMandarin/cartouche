"use client";

import { Clock } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LeaveDialog } from "@/components/editor/LeaveDialog";
import { describedBy, FieldMessage } from "@/components/editor/Field";
import { ErrorNotice } from "@/components/ErrorNotice";
import { useShellSlots } from "@/components/shell/AppShell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
import { joinLocalInput, splitLocalInput, userTimeZone, zoneLabel } from "@/lib/events/time";
import type { EventView } from "@/lib/events/types";
import { useLeaveGuard } from "@/lib/leave-guard";
import { ConsentEditor } from "./ConsentEditor";
import { CustomFieldsEditor } from "./CustomFieldsEditor";
import { EventStatePanel } from "./EventStatePanel";
import { StandardFieldsEditor } from "./StandardFieldsEditor";

function Section({
  id,
  title,
  aside,
  children,
}: {
  id: string;
  title: string;
  /** Beside the title: a note or a badge. */
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="bg-app-surface border-app-border rounded-app-lg shadow-app-sm flex flex-col gap-[18px] border p-6 @max-[847px]:p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={id} className="font-app-display text-xl font-semibold">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

const HINT = "text-app-muted text-[13px] leading-[1.4]";
const FIELD = "flex min-w-0 flex-col gap-1.5";

/** A date and a time side by side, over the `datetime-local` value of the draft. */
function DateTime({
  testId,
  value,
  onChange,
  dateLabel,
  timeLabel,
  disabled,
  invalid,
  describedBy: described,
}: {
  testId: string;
  value: string;
  onChange: (value: string) => void;
  dateLabel: string;
  timeLabel: string;
  disabled?: boolean;
  invalid?: true | undefined;
  describedBy: string | undefined;
}) {
  const { date, time } = splitLocalInput(value);
  return (
    <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-2">
      <Input
        type="date"
        data-testid={`${testId}-date`}
        aria-label={dateLabel}
        disabled={disabled}
        value={date}
        aria-invalid={invalid}
        aria-describedby={described}
        onChange={(e) => onChange(joinLocalInput(e.target.value, time))}
      />
      <Input
        type="time"
        data-testid={`${testId}-time`}
        aria-label={timeLabel}
        disabled={disabled}
        value={time}
        aria-invalid={invalid}
        aria-describedby={described}
        onChange={(e) => onChange(joinLocalInput(date, e.target.value))}
      />
    </div>
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

  /** The event was ended from the state panel: the end it now has is both stored and in the draft (EVT-006). */
  function onEnded(ended: EventView) {
    // The draft keeps the end as a date and a time of day to the minute, so the seconds of "now" are floored away.
    const { endsAt } = draftFromEvent(ended, zone);
    setSaved((current) => ({ ...current, endsAt }));
    setDraft((current) => ({ ...current, endsAt }));
  }

  // EDI-016, EDI-028: the browser asks before closing or reloading; a link of the page opens the leave dialog.
  const leaveGuard = useLeaveGuard({ dirty, save: persist });

  const noEnd = draft.endsAt === "";
  const field = (path: string) => ({
    "aria-invalid": messages[path] ? (true as const) : undefined,
    "aria-describedby": describedBy(path, messages[path]),
  });
  const saveLabel = busy ? t("events.editor.saving") : t("events.editor.save");
  const unsavedBadge = dirty ? <Badge variant="warning">{t("events.editor.unsaved")}</Badge> : null;
  const heading = event ? t("events.editor.titleEdit") : t("events.editor.titleNew");
  const eventName = saved.title.trim() || heading;

  // The save buttons live in the shell: the top bar on a computer, the sticky bar on a phone.
  useShellSlots({
    title: eventName,
    breadcrumb: [
      { label: t("shell.cards"), href: "/dashboard" },
      { label: t("events.title"), href: listHref },
      { label: eventName },
    ],
    back: { href: listHref, label: t("events.backToEvents") },
    topBarActions: (
      <>
        <p data-testid="event-status" role="status" className="contents">
          {unsavedBadge}
        </p>
        <Button asChild variant="secondary">
          <Link href={listHref} data-testid="event-back">
            {t("events.editor.cancel")}
          </Link>
        </Button>
        <Button type="button" data-testid="event-save" disabled={busy} onClick={() => void save()}>
          {saveLabel}
        </Button>
      </>
    ),
    saveBar: (
      <div className="flex flex-col gap-2 px-4 pt-3 pb-5">
        <p data-testid="event-status-phone" role="status" className="contents">
          {unsavedBadge}
        </p>
        <div className="flex gap-2.5">
          <Button asChild variant="secondary">
            <Link href={listHref} data-testid="event-back-bar">
              {t("events.editor.cancel")}
            </Link>
          </Button>
          <Button type="button" className="flex-1" data-testid="event-save-bar" disabled={busy} onClick={() => void save()}>
            {saveLabel}
          </Button>
        </div>
      </div>
    ),
  });

  return (
    <div className="flex flex-col gap-6 @max-[847px]:gap-4">
      <h1 className="text-[28px] leading-[1.2] font-bold tracking-[-0.02em] @max-[847px]:sr-only">{heading}</h1>
      <LeaveDialog
        guard={leaveGuard}
        description={t("events.editor.leave.body", {
          title: draft.title.trim() || saved.title.trim() || t("events.editor.leave.untitled"),
        })}
      />
      <div className="grid grid-cols-1 items-start gap-6 @max-[847px]:gap-4 @min-[1100px]:grid-cols-[minmax(0,1fr)_340px]">
        <form
          aria-label={heading}
          noValidate
          data-testid="event-editor"
          className="flex min-w-0 flex-col gap-5"
          onSubmit={(submitted) => {
            submitted.preventDefault();
            void save();
          }}
        >
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

          <Section id="event-section-general" title={t("events.editor.sections.general")}>
            <div className={FIELD}>
              <Label htmlFor="event-title">{t("events.editor.name")}</Label>
              <Input
                id="event-title"
                data-testid="event-title"
                autoComplete="off"
                value={draft.title}
                aria-invalid={messages.title ? true : undefined}
                aria-describedby={describedBy("title", messages.title, "event-title-hint")}
                onChange={(e) => edit({ ...draft, title: e.target.value }, ["title"])}
              />
              <p id="event-title-hint" className={HINT}>
                {t("events.editor.nameHint")}
              </p>
              <FieldMessage path="title" message={messages.title} />
            </div>
            <div className={FIELD}>
              <Label htmlFor="event-description">
                {t("events.editor.description")}{" "}
                <span className="text-app-muted font-normal">{t("events.editor.optional")}</span>
              </Label>
              <Textarea
                id="event-description"
                data-testid="event-description"
                rows={3}
                value={draft.description}
                {...field("description")}
                onChange={(e) => edit({ ...draft, description: e.target.value }, ["description"])}
              />
              <FieldMessage path="description" message={messages.description} />
            </div>
          </Section>

          <Section
            id="event-section-dates"
            title={t("events.editor.sections.dates")}
            aside={
              <Badge variant="neutral" className="before:hidden" data-testid="event-zone">
                <Clock aria-hidden="true" className="size-[15px]" />
                {t("events.editor.zone", { zone: zoneLabel(zone) })}
              </Badge>
            }
          >
            <div className="grid grid-cols-2 gap-4 @max-[847px]:grid-cols-1">
              <div role="group" aria-labelledby="event-starts-at-label" className={FIELD}>
                <span id="event-starts-at-label" className="text-sm leading-none font-semibold">
                  {t("events.editor.startsAt")}
                </span>
                <DateTime
                  testId="event-starts-at"
                  value={draft.startsAt}
                  dateLabel={t("events.editor.startDate")}
                  timeLabel={t("events.editor.startTime", { zone: zoneLabel(zone) })}
                  invalid={field("starts_at")["aria-invalid"]}
                  describedBy={field("starts_at")["aria-describedby"]}
                  onChange={(startsAt) => edit({ ...draft, startsAt }, ["starts_at", "ends_at"])}
                />
                <FieldMessage path="starts_at" message={messages.starts_at} />
              </div>
              <div role="group" aria-labelledby="event-ends-at-label" className={FIELD}>
                <span id="event-ends-at-label" className="text-sm leading-none font-semibold">
                  {t("events.editor.endsAt")}
                </span>
                <DateTime
                  testId="event-ends-at"
                  value={draft.endsAt}
                  disabled={noEnd}
                  dateLabel={t("events.editor.endDate")}
                  timeLabel={t("events.editor.endTime", { zone: zoneLabel(zone) })}
                  invalid={field("ends_at")["aria-invalid"]}
                  describedBy={field("ends_at")["aria-describedby"]}
                  onChange={(endsAt) => edit({ ...draft, endsAt }, ["ends_at"])}
                />
                <FieldMessage path="ends_at" message={messages.ends_at} />
              </div>
            </div>
            <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1">
              <Switch
                id="event-no-end"
                data-testid="event-no-end"
                checked={noEnd}
                onCheckedChange={(checked) =>
                  edit(checked ? { ...draft, endsAt: "" } : enableEnd(draft, zone), ["ends_at"])
                }
              />
              <Label htmlFor="event-no-end">
                {t("events.editor.noEnd")}{" "}
                <span className="text-app-muted font-normal">{t("events.editor.noEndHint")}</span>
              </Label>
            </div>
          </Section>

          <Section id="event-section-access" title={t("events.editor.sections.access")}>
            <div className="grid grid-cols-2 gap-4 @max-[847px]:grid-cols-1">
              <div className={FIELD}>
                <Label htmlFor="event-access-code">
                  {t("events.editor.accessCode")}{" "}
                  <span className="text-app-muted font-normal">{t("events.editor.optional")}</span>
                </Label>
                <Input
                  id="event-access-code"
                  data-testid="event-access-code"
                  type="text"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  className="font-app-mono tracking-[.06em]"
                  value={draft.accessCode}
                  aria-invalid={messages.access_code ? true : undefined}
                  aria-describedby={describedBy("access_code", messages.access_code, "event-access-code-hint")}
                  onChange={(e) => edit({ ...draft, accessCode: e.target.value }, ["access_code"])}
                />
                <p id="event-access-code-hint" className={HINT}>
                  {t("events.editor.accessCodeHint")}
                </p>
                <FieldMessage path="access_code" message={messages.access_code} />
              </div>
              <div className={FIELD}>
                <Label htmlFor="event-device-limit">{t("events.editor.deviceLimit")}</Label>
                <Input
                  id="event-device-limit"
                  data-testid="event-device-limit"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={100}
                  value={draft.deviceLimit}
                  aria-invalid={messages.device_limit ? true : undefined}
                  aria-describedby={describedBy("device_limit", messages.device_limit, "event-device-limit-hint")}
                  onChange={(e) => edit({ ...draft, deviceLimit: e.target.value }, ["device_limit"])}
                />
                <p id="event-device-limit-hint" className={HINT}>
                  {t("events.editor.deviceLimitHint")}
                </p>
                <FieldMessage path="device_limit" message={messages.device_limit} />
              </div>
            </div>
          </Section>

          <Section id="event-section-standard" title={t("events.editor.sections.standardFields")}>
            <StandardFieldsEditor
              value={draft.standardFields}
              error={messages.standard_fields}
              onChange={(name, mode) =>
                edit({ ...draft, standardFields: { ...draft.standardFields, [name]: mode } }, ["standard_fields"])
              }
            />
          </Section>

          <Section
            id="event-section-custom"
            title={t("events.editor.sections.customFields")}
            aside={<span className="text-app-muted text-sm">{t("events.editor.custom.hint")}</span>}
          >
            <CustomFieldsEditor draft={draft} errors={messages} onChange={edit} />
          </Section>

          <Section id="event-section-consent" title={t("events.editor.sections.consent")}>
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

        {event ? (
          <aside className="order-first @min-[1100px]:order-none">
            <EventStatePanel event={event} zone={zone} onEnded={onEnded} />
          </aside>
        ) : null}
      </div>
    </div>
  );
}
