import { useTranslations } from "next-intl";

interface ConsentFieldProps {
  text: string;
  checked: boolean;
  /** Message key of the error, if any. */
  error: string | undefined;
  onChange(checked: boolean): void;
}

/** The consent box, labelled by the exact text that will be recorded (FRM-006, FRM-008). */
export function ConsentField({ text, checked, error, onChange }: ConsentFieldProps) {
  const t = useTranslations();
  return (
    <div className="mt-6">
      <div className="flex items-start gap-3">
        <input
          id="lead-consent"
          type="checkbox"
          data-testid="consent-checkbox"
          className="mt-1 h-5 w-5 shrink-0"
          style={{ accentColor: "var(--c-accent)" }}
          aria-labelledby="consent-text"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "lead-consent-error" : undefined}
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
        />
        <label id="consent-text" htmlFor="lead-consent" data-testid="consent-text" className="text-sm whitespace-pre-line">
          {text}
        </label>
      </div>
      {error && (
        <p id="lead-consent-error" data-testid="field-error-consent" className="mt-1 text-sm font-medium">
          {t(error)}
        </p>
      )}
    </div>
  );
}
