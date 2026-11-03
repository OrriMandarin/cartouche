"use client";

import { useTranslations } from "next-intl";
import { useState, useSyncExternalStore } from "react";
import { cardPagePath } from "@/lib/card-urls";
import {
  checkLeadDraft,
  draftToSubmission,
  editDraft,
  emptyLeadDraft,
  refreshDraft,
  resumeDraft,
  type DraftEdit,
  type LeadDraft,
} from "@/lib/event-form/answers";
import { getDeviceId } from "@/lib/event-form/device";
import { afterReload, refusalAction, unlockMessageKey, utcDate, type RefusalAction } from "@/lib/event-form/flow";
import { submissionOutcome } from "@/lib/event-form/outcome";
import { clearDraft, loadDraft, saveDraft } from "@/lib/event-form/persist";
import { reloadForm, submitLead, unlockEvent } from "@/lib/event-form/requests";
import type { PublicEventForm } from "@/lib/event-form/types";
import type { PublicEventResponse } from "@/lib/public-event";
import type { PublicCard } from "@/templates/contract";
import { AccessCodeScreen } from "./AccessCodeScreen";
import { Confirmation } from "./Confirmation";
import { LeadForm } from "./LeadForm";
import { BUTTON_STYLE } from "./styles";

/** An event whose form can be filled now: open, or behind its access code. */
export type FillableEvent = Exclude<PublicEventResponse, { state: "closed" }>;

export interface EventFormPageProps {
  /** The current slug of the card. */
  slug: string;
  card: PublicCard;
  initial: FillableEvent;
}

const subscribeNever = () => () => {};

/** `false` on the server and while hydrating, `true` once the page reacts to input. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}

type Screen = "code" | "form" | "sent";

/**
 * The prospect's screens, common to every template (FRM-025, TPL-020): the access code (FRM-002), the form
 * (FRM-003) and the confirmation (FRM-004). The decisions come from `lib/event-form`.
 */
export function EventFormPage({ slug, card, initial }: EventFormPageProps) {
  const t = useTranslations();
  const eventId = initial.event.id;
  const hydrated = useHydrated();
  const [screen, setScreen] = useState<Screen>(initial.state === "open" ? "form" : "code");
  const [form, setForm] = useState<PublicEventForm | null>(initial.state === "open" ? initial.event : null);
  const [accessCode, setAccessCode] = useState<string | null>(null);
  // `null` until the prospect types: the draft kept for a reload (FRM-040) is then shown.
  const [typed, setTyped] = useState<LeadDraft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [attempt, setAttempt] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [retry, setRetry] = useState(false);
  const [pending, setPending] = useState(false);

  const cardHref = cardPagePath(slug);
  const draft =
    form && (typed ?? (hydrated ? resumeDraft(form, null, loadDraft(eventId)) : emptyLeadDraft(form)));

  function keep(next: LeadDraft) {
    setTyped(next);
    saveDraft(eventId, next);
  }

  function edit(change: DraftEdit) {
    if (draft) keep(editDraft(draft, change));
  }

  function askCode(next: LeadDraft, notice: string) {
    setTyped(next);
    setScreen("code");
    setMessage(notice);
  }

  async function unlock(code: string) {
    setPending(true);
    try {
      const unlocked = await unlockEvent(slug, eventId, code);
      const current = form && draft ? { draft, formVersion: form.form_version } : null;
      setTyped(resumeDraft(unlocked, current, loadDraft(eventId)));
      setForm(unlocked);
      setAccessCode(code);
      setScreen("form");
      setMessage(null);
      setRetry(false);
      setErrors({});
    } catch (error) {
      setMessage(unlockMessageKey(submissionOutcome(error)));
    } finally {
      setPending(false);
    }
  }

  async function refuse(action: RefusalAction, sent: LeadDraft) {
    switch (action.kind) {
      case "fields":
        setErrors(action.fields);
        setMessage("eventForm.fix");
        setAttempt((count) => count + 1);
        return;
      case "ask_code":
        askCode(sent, action.message);
        return;
      case "message":
        setMessage(action.message);
        setRetry(action.retry);
        return;
      case "reload_form":
        await reload(sent);
    }
  }

  async function reload(sent: LeadDraft) {
    try {
      const next = afterReload(await reloadForm(slug, eventId, accessCode));
      if (next.kind !== "form") {
        await refuse(next, sent);
        return;
      }
      setForm(next.form);
      keep(refreshDraft(sent, next.form));
      setErrors({});
      setMessage(next.message);
    } catch (error) {
      const action = refusalAction(submissionOutcome(error));
      // The routes that load a form never answer `form_changed`: no second reload.
      await refuse(action.kind === "reload_form" ? refusalAction({ kind: "unknown" }) : action, sent);
    }
  }

  async function send(current: PublicEventForm, sent: LeadDraft) {
    setPending(true);
    setMessage(null);
    setRetry(false);
    try {
      await submitLead(slug, eventId, draftToSubmission(current, sent, getDeviceId(), accessCode));
      clearDraft(eventId);
      setScreen("sent");
    } catch (error) {
      await refuse(refusalAction(submissionOutcome(error)), sent);
    } finally {
      setPending(false);
    }
  }

  function submit() {
    if (!form || !draft) return;
    const found = checkLeadDraft(form, draft, utcDate(new Date()));
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setMessage("eventForm.fix");
      setRetry(false);
      setAttempt((count) => count + 1);
      return;
    }
    void send(form, draft);
  }

  if (screen === "sent") {
    return (
      <div className="mx-auto max-w-md px-5 py-6">
        <Confirmation vcardUrl={card.vcard_url} cardHref={cardHref} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-5 py-6">
      <a data-testid="event-form-back" href={cardHref} className="inline-block underline">
        {t("eventForm.back")}
      </a>
      {screen === "code" || !form || !draft ? (
        <AccessCodeScreen
          title={form?.title ?? initial.event.title}
          message={message}
          disabled={!hydrated || pending}
          onSubmit={(code) => void unlock(code)}
        />
      ) : (
        <LeadForm
          form={form}
          draft={draft}
          errors={errors}
          attempt={attempt}
          disabled={!hydrated || pending}
          notice={
            message && (
              <div role="alert" data-testid="event-form-message" className="mt-6 font-medium">
                <p>{t(message)}</p>
                {retry && (
                  <button
                    type="button"
                    data-testid="event-form-retry"
                    className="mt-3 px-4 py-2"
                    style={BUTTON_STYLE}
                    onClick={() => void send(form, draft)}
                  >
                    {t("eventForm.retry")}
                  </button>
                )}
              </div>
            )
          }
          onEdit={edit}
          onSubmit={submit}
        />
      )}
    </div>
  );
}
