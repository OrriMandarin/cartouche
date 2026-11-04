import { CircleAlert, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, type FormEvent, type HTMLAttributes, type ReactNode } from "react";
import type { AddressPart, DraftEdit, LeadDraft, StandardAnswerKey } from "@/lib/event-form/answers";
import { errorCount } from "@/lib/event-form/errors";
import type { PublicCustomField, PublicEventForm } from "@/lib/event-form/types";
import { privacyUrl } from "@/lib/instance-links";
import { ConsentField } from "./ConsentField";
import { ErrorText, FormHead } from "./FormChrome";
import { Honeypot } from "./Honeypot";

type InputMode = HTMLAttributes<HTMLInputElement>["inputMode"];

interface InputKind {
  type: "text" | "email" | "tel" | "date" | "datetime-local";
  autoComplete: string;
  inputMode?: InputMode;
}

// Keyboard and browser autofill of each standard field (FRM-005, FRM-039).
const STANDARD_INPUTS: Record<StandardAnswerKey, InputKind> = {
  first_name: { type: "text", autoComplete: "given-name" },
  last_name: { type: "text", autoComplete: "family-name" },
  birth_date: { type: "date", autoComplete: "bday" },
  email: { type: "email", autoComplete: "email", inputMode: "email" },
  phone: { type: "tel", autoComplete: "tel", inputMode: "tel" },
};

const ADDRESS_INPUTS: Record<AddressPart, InputKind> = {
  street: { type: "text", autoComplete: "street-address" },
  postal_code: { type: "text", autoComplete: "postal-code" },
  city: { type: "text", autoComplete: "address-level2" },
  country: { type: "text", autoComplete: "country-name" },
};

const ADDRESS_PARTS: AddressPart[] = ["street", "postal_code", "city", "country"];

function inputId(path: string): string {
  return `lead-${path}`;
}

function describedBy(...ids: (string | false | undefined)[]): string | undefined {
  const present = ids.filter(Boolean);
  return present.length > 0 ? present.join(" ") : undefined;
}

/** "(facultatif)" after the label of an optional field; a required one carries no mark (FRM-045). */
function OptionalMark({ required }: { required: boolean }) {
  const t = useTranslations("eventForm");
  return required ? null : <span className="fm-opt"> ({t("optional")})</span>;
}

interface FieldProps {
  path: string;
  label: string;
  required: boolean;
  help?: string | null;
  /** Error code of the field, if any. */
  error: string | undefined;
  /** The kind of a custom field. */
  kind?: PublicCustomField["kind"];
  children(props: { id: string; "aria-invalid"?: true; "aria-describedby"?: string; "data-testid": string }): ReactNode;
}

/** A label, its help, the control and its error, right next to it (FRM-015, FRM-045). */
function Field({ path, label, required, help, error, kind, children }: FieldProps) {
  const id = inputId(path);
  const helpId = help ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className="fm-field">
      <label htmlFor={id} className="fm-label">
        {label}
        <OptionalMark required={required} />
      </label>
      {help && (
        <p id={helpId} className="fm-hint">
          {help}
        </p>
      )}
      {children({
        id,
        ...(error ? { "aria-invalid": true } : {}),
        "aria-describedby": describedBy(helpId, errorId),
        "data-testid": `field-${path}`,
      })}
      {error && <ErrorText id={errorId} path={path} code={error} kind={kind} />}
    </div>
  );
}

interface TextInputProps {
  path: string;
  label: string;
  required: boolean;
  kind: InputKind;
  value: string;
  error: string | undefined;
  help?: string | null;
  /** The kind of a custom field. */
  fieldKind?: PublicCustomField["kind"];
  onChange(value: string): void;
}

function TextInput({ path, label, required, kind, value, error, help, fieldKind, onChange }: TextInputProps) {
  return (
    <Field path={path} label={label} required={required} help={help} error={error} kind={fieldKind}>
      {(attributes) => (
        <input
          {...attributes}
          type={kind.type}
          autoComplete={kind.autoComplete}
          inputMode={kind.inputMode}
          aria-required={required || undefined}
          className="fm-input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

/** The input of a custom field typed as text: native pickers and keyboards (FRM-039, FRM-045). */
function customInputKind(kind: PublicCustomField["kind"]): InputKind {
  switch (kind) {
    case "date":
      return { type: "date", autoComplete: "off" };
    case "datetime":
      return { type: "datetime-local", autoComplete: "off" };
    case "number":
      return { type: "text", autoComplete: "off", inputMode: "decimal" };
    default:
      return { type: "text", autoComplete: "off" };
  }
}

interface CustomInputProps {
  field: PublicCustomField;
  value: string | boolean | undefined;
  error: string | undefined;
  onChange(value: string | boolean): void;
}

function CustomInput({ field, value, error, onChange }: CustomInputProps) {
  const t = useTranslations("eventForm.fields");
  const path = `answers.custom.${field.id}`;
  const text = typeof value === "string" ? value : "";
  const common = { path, label: field.label, required: field.required, help: field.help, error, kind: field.kind };

  switch (field.kind) {
    case "checkbox": {
      const id = inputId(path);
      const errorId = error ? `${id}-error` : undefined;
      const helpId = field.help ? `${id}-help` : undefined;
      return (
        <div className="fm-field">
          <div className="fm-check">
            <input
              id={id}
              type="checkbox"
              data-testid={`field-${path}`}
              aria-invalid={error ? true : undefined}
              aria-describedby={describedBy(helpId, errorId)}
              checked={value === true}
              onChange={(event) => onChange(event.target.checked)}
            />
            <label htmlFor={id}>{field.label}</label>
          </div>
          {field.help && (
            <p id={helpId} className="fm-hint">
              {field.help}
            </p>
          )}
          {error && <ErrorText id={errorId} path={path} code={error} kind="checkbox" />}
        </div>
      );
    }
    case "long_text":
      return (
        <Field {...common}>
          {(attributes) => (
            <textarea
              {...attributes}
              rows={4}
              aria-required={field.required || undefined}
              className="fm-input"
              value={text}
              onChange={(event) => onChange(event.target.value)}
            />
          )}
        </Field>
      );
    case "single_choice":
      return (
        <Field {...common}>
          {(attributes) => (
            <select
              {...attributes}
              aria-required={field.required || undefined}
              className="fm-input"
              value={text}
              onChange={(event) => onChange(event.target.value)}
            >
              <option value="">{t("choose")}</option>
              {(field.options ?? []).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          )}
        </Field>
      );
    default:
      return (
        <TextInput
          {...common}
          fieldKind={field.kind}
          kind={customInputKind(field.kind)}
          value={text}
          onChange={onChange}
        />
      );
  }
}

type StandardField = PublicEventForm["standard_fields"][number];

/** The standard fields, the first and last names side by side when both follow each other (FRM-044). */
function standardRows(fields: StandardField[]): StandardField[][] {
  const rows: StandardField[][] = [];
  fields.forEach((entry, index) => {
    const previous = fields[index - 1];
    if (entry.field === "last_name" && previous?.field === "first_name") rows.at(-1)!.push(entry);
    else rows.push([entry]);
  });
  return rows;
}

export interface LeadFormProps {
  form: PublicEventForm;
  /** The card's full name: the only one the answers are sent to (FRM-044). */
  ownerName: string;
  draft: LeadDraft;
  /** Error codes by field path. */
  errors: Record<string, string>;
  /** Increases at each refused submission: the first invalid field then takes the focus. */
  attempt: number;
  /** Not ready (before hydration) or busy (sending). */
  disabled: boolean;
  /** Shown right above the button: what became of the last submission. */
  notice: ReactNode;
  onEdit(edit: DraftEdit): void;
  onSubmit(): void;
}

/**
 * The form of an event (FRM-003, FRM-044): the band with its title and description, the note, the standard
 * fields under "Vos coordonnées", the custom ones under "Votre projet", the consent, the trap field, the button
 * and the privacy line. Every decision is the caller's (`lib/event-form`).
 */
export function LeadForm({ form, ownerName, draft, errors, attempt, disabled, notice, onEdit, onSubmit }: LeadFormProps) {
  const t = useTranslations("eventForm");
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (attempt > 0) ref.current?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus();
  }, [attempt]);

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit();
  }

  function standardInput({ field, required }: StandardField) {
    if (field === "address") {
      return (
        <fieldset key={field} className="fm-set fm-fields">
          <legend className="fm-label fm-sublegend">
            {t("fields.address")}
            <OptionalMark required={required} />
          </legend>
          {ADDRESS_PARTS.map((part) => {
            const path = `answers.address.${part}`;
            return (
              <TextInput
                key={part}
                path={path}
                label={t(`fields.${part}`)}
                required={required}
                kind={ADDRESS_INPUTS[part]}
                value={draft.answers.address[part]}
                error={errors[path]}
                onChange={(value) => onEdit({ field: "address", part, value })}
              />
            );
          })}
        </fieldset>
      );
    }
    const path = `answers.${field}`;
    return (
      <TextInput
        key={field}
        path={path}
        label={t(`fields.${field}`)}
        required={required}
        kind={STANDARD_INPUTS[field]}
        value={draft.answers[field]}
        error={errors[path]}
        onChange={(value) => onEdit({ field, value })}
      />
    );
  }

  const errorTotal = errorCount(errors);

  return (
    <>
      <FormHead title={form.title} description={form.description} live />
      <form ref={ref} data-testid="event-form" noValidate onSubmit={submit} className="fm-form">
        <p className="fm-note">{t("note")}</p>
        {errorTotal > 0 && (
          <div role="alert" data-testid="event-form-summary" className="fm-alert">
            <CircleAlert className="ic" aria-hidden="true" />
            <p>{t("summary", { count: errorTotal })}</p>
          </div>
        )}
        <fieldset disabled={disabled} className="fm-set fm-form">
          <fieldset className="fm-set">
            <legend className="fm-legend">{t("sections.contact")}</legend>
            <div className="fm-fields">
              {standardRows(form.standard_fields).map((row) =>
                row.length === 2 ? (
                  <div key={row[0]!.field} className="fm-row2">
                    {row.map(standardInput)}
                  </div>
                ) : (
                  standardInput(row[0]!)
                ),
              )}
            </div>
          </fieldset>

          {form.custom_fields.length > 0 && (
            <fieldset className="fm-set">
              <legend className="fm-legend">{t("sections.project")}</legend>
              <div className="fm-fields">
                {form.custom_fields.map((field) => (
                  <CustomInput
                    key={field.id}
                    field={field}
                    value={draft.custom[field.id]}
                    error={errors[`answers.custom.${field.id}`]}
                    onChange={(value) => onEdit({ field: "custom", id: field.id, value })}
                  />
                ))}
              </div>
            </fieldset>
          )}

          <ConsentField
            text={form.consent_text}
            checked={draft.consent}
            error={errors.consent}
            onChange={(value) => onEdit({ field: "consent", value })}
          />
          <Honeypot value={draft.fax} onChange={(value) => onEdit({ field: "fax", value })} />

          {notice}
          <div className="fm-actions">
            <button type="submit" data-testid="event-form-submit" className="fm-submit">
              <Send className="ic" aria-hidden="true" />
              {t("submit")}
            </button>
            <p className="fm-privacy">
              {t("privacy", { name: ownerName })} <a href={privacyUrl()}>{t("privacyLink")}</a>
            </p>
          </div>
        </fieldset>
      </form>
    </>
  );
}
