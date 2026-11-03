import { useTranslations } from "next-intl";
import { useEffect, useRef, type FormEvent, type HTMLAttributes, type ReactNode } from "react";
import type { AddressPart, DraftEdit, LeadDraft, StandardAnswerKey } from "@/lib/event-form/answers";
import type { PublicCustomField, PublicEventForm } from "@/lib/event-form/types";
import { ConsentField } from "./ConsentField";
import { Honeypot } from "./Honeypot";
import { BUTTON_STYLE, HEADING_STYLE, INPUT_CLASS, INPUT_STYLE } from "./styles";

type InputMode = HTMLAttributes<HTMLInputElement>["inputMode"];

interface InputKind {
  type: "text" | "email" | "tel" | "date";
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

/** The message of a field error, next to its field (FRM-015). */
function ErrorText({ id, path, message }: { id: string | undefined; path: string; message: string }) {
  const t = useTranslations();
  return (
    <p id={id} data-testid={`field-error-${path}`} className="mt-1 text-sm font-medium">
      {t(message)}
    </p>
  );
}

interface FieldProps {
  path: string;
  label: string;
  required: boolean;
  help?: string | null;
  /** Message key of the error, if any. */
  error: string | undefined;
  children(props: { id: string; "aria-invalid"?: true; "aria-describedby"?: string; "data-testid": string }): ReactNode;
}

/** A label, the control, its help and its error, right next to it (FRM-015). */
function Field({ path, label, required, help, error, children }: FieldProps) {
  const t = useTranslations();
  const id = inputId(path);
  const helpId = help ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className="mt-4">
      <label htmlFor={id} className="block font-medium">
        {label}
        {!required && <span className="font-normal opacity-75"> ({t("eventForm.optional")})</span>}
      </label>
      {help && (
        <p id={helpId} className="text-sm opacity-80">
          {help}
        </p>
      )}
      <div className="mt-1">
        {children({
          id,
          ...(error ? { "aria-invalid": true } : {}),
          "aria-describedby": describedBy(helpId, errorId),
          "data-testid": `field-${path}`,
        })}
      </div>
      {error && <ErrorText id={errorId} path={path} message={error} />}
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
  onChange(value: string): void;
}

function TextInput({ path, label, required, kind, value, error, help, onChange }: TextInputProps) {
  return (
    <Field path={path} label={label} required={required} help={help} error={error}>
      {(attributes) => (
        <input
          {...attributes}
          type={kind.type}
          autoComplete={kind.autoComplete}
          inputMode={kind.inputMode}
          aria-required={required || undefined}
          className={INPUT_CLASS}
          style={INPUT_STYLE}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
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
  const common = { path, label: field.label, required: field.required, help: field.help, error };

  switch (field.kind) {
    case "checkbox": {
      const id = inputId(path);
      const errorId = error ? `${id}-error` : undefined;
      const helpId = field.help ? `${id}-help` : undefined;
      return (
        <div className="mt-4">
          <div className="flex items-start gap-3">
            <input
              id={id}
              type="checkbox"
              data-testid={`field-${path}`}
              className="mt-1 h-5 w-5 shrink-0"
              style={{ accentColor: "var(--c-accent)" }}
              aria-invalid={error ? true : undefined}
              aria-describedby={describedBy(helpId, errorId)}
              checked={value === true}
              onChange={(event) => onChange(event.target.checked)}
            />
            <label htmlFor={id} className="font-medium">
              {field.label}
            </label>
          </div>
          {field.help && (
            <p id={helpId} className="text-sm opacity-80">
              {field.help}
            </p>
          )}
          {error && <ErrorText id={errorId} path={path} message={error} />}
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
              className={INPUT_CLASS}
              style={INPUT_STYLE}
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
              className={INPUT_CLASS}
              style={INPUT_STYLE}
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
    default: {
      const kind: InputKind =
        field.kind === "date"
          ? { type: "date", autoComplete: "off" }
          : field.kind === "number"
            ? { type: "text", autoComplete: "off", inputMode: "decimal" }
            : { type: "text", autoComplete: "off" };
      return <TextInput {...common} kind={kind} value={text} onChange={onChange} />;
    }
  }
}

export interface LeadFormProps {
  form: PublicEventForm;
  draft: LeadDraft;
  /** Message keys by field path. */
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
 * The form of an event: its title and description, then the standard fields, then the custom ones (FRM-003),
 * the consent, the trap field and the button. Every decision is the caller's (`lib/event-form`).
 */
export function LeadForm({ form, draft, errors, attempt, disabled, notice, onEdit, onSubmit }: LeadFormProps) {
  const t = useTranslations("eventForm");
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (attempt > 0) ref.current?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus();
  }, [attempt]);

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit();
  }

  return (
    <form ref={ref} data-testid="event-form" noValidate onSubmit={submit} className="relative py-6">
      <h1 data-testid="event-form-title" className="text-2xl font-bold" style={HEADING_STYLE}>
        {form.title}
      </h1>
      {form.description && (
        <p data-testid="event-form-description" className="mt-3 whitespace-pre-line">
          {form.description}
        </p>
      )}

      <fieldset disabled={disabled} className="mt-2">
        {form.standard_fields.map(({ field, required }) => {
          if (field === "address") {
            return (
              <fieldset key={field} className="mt-6">
                <legend className="font-semibold">
                  {t("fields.address")}
                  {!required && <span className="font-normal opacity-75"> ({t("optional")})</span>}
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
        })}

        {form.custom_fields.map((field) => (
          <CustomInput
            key={field.id}
            field={field}
            value={draft.custom[field.id]}
            error={errors[`answers.custom.${field.id}`]}
            onChange={(value) => onEdit({ field: "custom", id: field.id, value })}
          />
        ))}

        <ConsentField
          text={form.consent_text}
          checked={draft.consent}
          error={errors.consent}
          onChange={(value) => onEdit({ field: "consent", value })}
        />
        <Honeypot value={draft.fax} onChange={(value) => onEdit({ field: "fax", value })} />

        {notice}
        <button
          type="submit"
          data-testid="event-form-submit"
          className="mt-6 w-full px-5 py-3 text-lg font-semibold"
          style={BUTTON_STYLE}
        >
          {t("submit")}
        </button>
      </fieldset>
    </form>
  );
}
