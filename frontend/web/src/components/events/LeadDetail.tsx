"use client";

import { Flag, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { ErrorNotice } from "@/components/ErrorNotice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { displayAnswer, displayBirthDate } from "@/lib/events/lead-answers";
import type { LeadActions, LeadChange } from "@/lib/events/lead-actions";
import { leadHeading } from "@/lib/events/leads";
import { formatLeadMoment } from "@/lib/events/time";
import type { AnswerSnapshot, LeadView } from "@/lib/events/types";
import { LeadDeleteDialog } from "./LeadDeleteDialog";
import { useLeadMutations } from "./use-lead-mutations";

type StandardKey = keyof LeadView["answers"];

const PERSONAL_FIELDS = ["first_name", "last_name", "email", "phone", "birth_date"] as const satisfies readonly StandardKey[];
const ADDRESS_FIELDS = ["street", "postal_code", "city", "country"] as const satisfies readonly StandardKey[];

function Section({ title, testId, children }: { title: string; testId?: string; children: ReactNode }) {
  return (
    <section data-testid={testId} className="border-app-border flex flex-col gap-3 border-t px-6 py-5">
      <h3 className="text-base leading-[1.35] font-[650]">{title}</h3>
      {children}
    </section>
  );
}

function Row({ testId, label, children }: { testId: string; label: string; children: ReactNode }) {
  return (
    <div data-testid={testId} className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-x-4 text-[15px]">
      <dt className="text-app-muted">{label}</dt>
      <dd className="min-w-0 font-medium break-words whitespace-pre-line">{children}</dd>
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

/** The email and the phone number can be used straight from the detail (mail and call links). */
function StandardValue({ lead, field }: { lead: LeadView; field: StandardKey }) {
  const value = standardValue(lead, field);
  const href = field === "email" ? `mailto:${lead.answers.email}` : field === "phone" ? `tel:${lead.answers.phone}` : null;
  return href === null ? (
    <>{value}</>
  ) : (
    <a href={href} className="underline underline-offset-3">
      {value}
    </a>
  );
}

/**
 * spec: LEA-003, LEA-004, LEA-018, LEA-019, LEA-020, LEA-034. Everything one contact answered, as recorded, with the
 * consent, in a side sheet (a full-screen one on phones); the owner can mark it as spam or delete it (after a
 * confirmation), which closes the sheet. Without `actions` the view is read-only.
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

  // The sheet is modal, so it closes once the mark is set: the toast of LEA-034 must be within reach.
  async function toggleSpam() {
    if (await mutations.toggleSpam(lead)) onClose();
  }

  async function confirmDelete() {
    setConfirmingDelete(false);
    if (await mutations.remove(lead)) onClose();
  }

  return (
    <Sheet open onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent
        closeLabel={t("detail.close")}
        data-testid="lead-detail"
        className="inset-0 max-h-none gap-0 rounded-none p-0 md:w-[500px]"
      >
        <SheetHeader className="gap-1.5 px-6 pt-5 pb-4">
          <SheetTitle data-testid="lead-detail-name" className="text-xl break-words">
            {heading.kind === "unnamed" ? t("unnamed") : heading.text}
          </SheetTitle>
          <SheetDescription>
            <span data-testid="lead-detail-submitted">{formatLeadMoment(lead.submitted_at, zone, true)}</span>
            {" · "}
            <span data-testid="lead-detail-event">{lead.event_title}</span>
          </SheetDescription>
          {lead.spam ? (
            <Badge variant="danger" data-testid="lead-detail-spam-state" className="mt-1">
              {t("spamBadge")}
            </Badge>
          ) : null}
        </SheetHeader>

        {actions ? (
          <div className="flex flex-wrap gap-2 px-6 pb-5">
            <Button
              variant="secondary"
              disabled={mutations.busy}
              data-testid="lead-detail-spam"
              onClick={() => void toggleSpam()}
            >
              <Flag aria-hidden="true" />
              {lead.spam ? t("unmarkSpam") : t("markSpam")}
            </Button>
            <Button
              variant="dangerGhost"
              disabled={mutations.busy}
              data-testid="lead-detail-delete"
              onClick={() => setConfirmingDelete(true)}
            >
              <Trash2 aria-hidden="true" />
              {t("delete")}
            </Button>
          </div>
        ) : null}

        {mutations.error !== null ? (
          <div className="px-6 pb-4">
            <ErrorNotice error={mutations.error} />
          </div>
        ) : null}

        <div className="flex-1 overflow-y-auto">
          <Section title={t("detail.coordinates")}>
            <dl className="space-y-2.5">
              {personal.map((key) => (
                <Row key={key} testId={`lead-detail-field-${key}`} label={t(`detail.fields.${key}`)}>
                  <StandardValue lead={lead} field={key} />
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
            </dl>
          </Section>
          {lead.custom.length > 0 ? (
            <Section title={t("detail.answers")}>
              <dl className="space-y-2.5">
                {lead.custom.map((answer) => (
                  <Row key={answer.field_id} testId={`lead-detail-answer-${answer.field_id}`} label={answer.label}>
                    <AnswerValue answer={answer} />
                  </Row>
                ))}
              </dl>
            </Section>
          ) : null}
          <Section title={t("detail.consent")} testId="lead-detail-consent">
            <p className="text-[13px] leading-[1.4]">
              <b>{t("detail.accepted")}</b> {t("detail.acceptedOn", { moment: formatLeadMoment(lead.consent_at, zone, false) })}
            </p>
            <p className="bg-app-surface-2 rounded-app-lg p-3 text-sm leading-[1.45] whitespace-pre-line">
              {`« ${lead.consent_text} »`}
            </p>
          </Section>
        </div>

        <LeadDeleteDialog
          open={confirmingDelete}
          busy={mutations.busy}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => void confirmDelete()}
        />
      </SheetContent>
    </Sheet>
  );
}
