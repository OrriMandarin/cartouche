"use client";

import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { ErrorNotice } from "@/components/ErrorNotice";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { displayAnswer, displayBirthDate } from "@/lib/events/lead-answers";
import type { LeadActions, LeadChange } from "@/lib/events/lead-actions";
import { leadHeading } from "@/lib/events/leads";
import { formatEventDate } from "@/lib/events/time";
import type { AnswerSnapshot, LeadView } from "@/lib/events/types";
import { LeadDeleteDialog } from "./LeadDeleteDialog";
import { useLeadMutations } from "./use-lead-mutations";

type StandardKey = keyof LeadView["answers"];

const PERSONAL_FIELDS = ["first_name", "last_name", "email", "phone", "birth_date"] as const satisfies readonly StandardKey[];
const ADDRESS_FIELDS = ["street", "postal_code", "city", "country"] as const satisfies readonly StandardKey[];

function Row({ testId, label, children }: { testId: string; label: string; children: ReactNode }) {
  return (
    <div data-testid={testId} className="grid gap-1 sm:grid-cols-[10rem_1fr] sm:gap-4">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="min-w-0 break-words whitespace-pre-line">{children}</dd>
    </div>
  );
}

function AnswerValue({ answer }: { answer: AnswerSnapshot }) {
  const t = useTranslations("leads.detail");
  const display = displayAnswer(answer);
  return <>{display.kind === "text" ? display.text : t(display.kind)}</>;
}

/** The value of a standard field as the detail shows it (LEA-019: the date of birth is a French date, the phone as people write it). */
function standardValue(lead: LeadView, key: StandardKey): string | null {
  const value = key === "phone" ? lead.phone_display : lead.answers[key];
  if (!value) return null;
  return key === "birth_date" ? displayBirthDate(value) : value;
}

/**
 * spec: LEA-003, LEA-018, LEA-019, LEA-004, LEA-020. Everything one contact answered, as recorded, with the consent
 * and the spam mark; the owner can mark it as spam or delete it (after a confirmation), which closes the detail.
 * Without `actions` the view is read-only.
 */
export function LeadDetail({
  lead,
  zone,
  actions,
  onChange,
  onClose,
}: {
  lead: LeadView;
  zone: string;
  actions: LeadActions | null;
  onChange: (change: LeadChange) => void;
  onClose: () => void;
}) {
  const t = useTranslations("leads");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const mutations = useLeadMutations(actions, onChange);
  const heading = leadHeading(lead);
  const personal = PERSONAL_FIELDS.filter((key) => standardValue(lead, key) !== null);
  const address = ADDRESS_FIELDS.filter((key) => standardValue(lead, key) !== null);

  async function confirmDelete() {
    setConfirmingDelete(false);
    if (await mutations.remove(lead)) onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent closeLabel={t("detail.close")} data-testid="lead-detail" className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("detail.title")}</DialogTitle>
          <DialogDescription data-testid="lead-detail-name" className="text-foreground text-lg font-semibold break-words">
            {heading.kind === "unnamed" ? t("unnamed") : heading.text}
          </DialogDescription>
        </DialogHeader>

        {mutations.error !== null ? <ErrorNotice error={mutations.error} /> : null}

        <dl className="space-y-3">
          <Row testId="lead-detail-event" label={t("detail.event")}>
            {lead.event_title}
          </Row>
          <Row testId="lead-detail-submitted" label={t("detail.submittedAt")}>
            {formatEventDate(lead.submitted_at, zone)}
          </Row>
          {personal.map((key) => (
            <Row key={key} testId={`lead-detail-field-${key}`} label={t(`detail.fields.${key}`)}>
              {standardValue(lead, key)}
            </Row>
          ))}
          {address.length > 0 ? (
            <Row testId="lead-detail-address" label={t("detail.address")}>
              {address.map((key) => (
                <span key={key} data-testid={`lead-detail-field-${key}`} className="block">
                  {standardValue(lead, key)}
                </span>
              ))}
            </Row>
          ) : null}
          {lead.custom.map((answer) => (
            <Row key={answer.field_id} testId={`lead-detail-answer-${answer.field_id}`} label={answer.label}>
              <AnswerValue answer={answer} />
            </Row>
          ))}
        </dl>

        <div data-testid="lead-detail-consent" className="space-y-1 rounded-md border p-3 text-sm">
          <p className="font-medium">
            {t("detail.consentAt")} {formatEventDate(lead.consent_at, zone)}
          </p>
          <p className="text-muted-foreground whitespace-pre-line">{lead.consent_text}</p>
        </div>

        <p data-testid="lead-detail-spam-state" className="text-sm">
          {lead.spam ? t("detail.spam") : t("detail.notSpam")}
        </p>

        {actions ? (
          <DialogFooter>
            <Button
              variant="outline"
              disabled={mutations.busy}
              data-testid="lead-detail-spam"
              onClick={() => void mutations.toggleSpam(lead)}
            >
              {lead.spam ? t("unmarkSpam") : t("markSpam")}
            </Button>
            <Button
              variant="outline"
              disabled={mutations.busy}
              data-testid="lead-detail-delete"
              onClick={() => setConfirmingDelete(true)}
            >
              {t("delete")}
            </Button>
          </DialogFooter>
        ) : null}

        <LeadDeleteDialog
          open={confirmingDelete}
          busy={mutations.busy}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => void confirmDelete()}
        />
      </DialogContent>
    </Dialog>
  );
}
