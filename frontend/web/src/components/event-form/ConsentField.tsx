import { ErrorText } from "./FormChrome";

interface ConsentFieldProps {
  text: string;
  checked: boolean;
  /** Error code of the consent, if any. */
  error: string | undefined;
  onChange(checked: boolean): void;
}

/** The consent box, labelled by the exact text that will be recorded (FRM-006, FRM-008). */
export function ConsentField({ text, checked, error, onChange }: ConsentFieldProps) {
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
      {error && <ErrorText id="lead-consent-error" path="consent" code={error} />}
    </div>
  );
}
