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
    <div className="fm-field">
      <div className="fm-check">
        <input
          id="lead-consent"
          type="checkbox"
          data-testid="consent-checkbox"
          aria-labelledby="consent-text"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "lead-consent-error" : undefined}
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
        />
        <label id="consent-text" htmlFor="lead-consent" data-testid="consent-text">
          {text}
        </label>
      </div>
      {error && (
        <p id="lead-consent-error" data-testid="field-error-consent" className="fm-error">
          {t(error)}
        </p>
      )}
    </div>
  );
}
