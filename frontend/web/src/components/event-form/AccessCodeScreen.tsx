import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { FormHead } from "./FormChrome";

interface AccessCodeScreenProps {
  title: string;
  /** Message key of what went wrong with the last attempt, if anything. */
  message: string | null;
  /** Not ready (before hydration) or busy (a code is being checked). */
  disabled: boolean;
  onSubmit(code: string): void;
}

/**
 * The code asked before the form of an event that has one (FRM-002, FRM-048): the title only, then a single
 * field and its button. The server checks it (EVT-012).
 */
export function AccessCodeScreen({ title, message, disabled, onSubmit }: AccessCodeScreenProps) {
  const t = useTranslations();
  const [code, setCode] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit(code);
  }

  return (
    <>
      <FormHead title={title} live={false} />
      <form data-testid="access-code-form" noValidate onSubmit={submit} className="fm-form">
        <fieldset disabled={disabled} className="fm-set fm-fields">
          <div className="fm-field">
            <label htmlFor="access-code" className="fm-label">
              {t("eventForm.code.label")}
            </label>
            <p id="access-code-intro" className="fm-hint">
              {t("eventForm.code.intro")}
            </p>
            <input
              id="access-code"
              data-testid="access-code-input"
              type="text"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              className="fm-input"
              aria-invalid={message ? true : undefined}
              aria-describedby={message ? "access-code-intro access-code-message" : "access-code-intro"}
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
            {message && (
              <p id="access-code-message" role="alert" data-testid="access-code-message" className="fm-error">
                {t(message)}
              </p>
            )}
          </div>
          <button type="submit" data-testid="access-code-submit" className="fm-submit">
            {t("eventForm.code.submit")}
          </button>
        </fieldset>
      </form>
    </>
  );
}
