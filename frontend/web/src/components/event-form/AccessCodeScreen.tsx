import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { BUTTON_STYLE, HEADING_STYLE, INPUT_CLASS, INPUT_STYLE } from "./styles";

interface AccessCodeScreenProps {
  title: string;
  /** Message key of what went wrong with the last attempt, if anything. */
  message: string | null;
  /** Not ready (before hydration) or busy (a code is being checked). */
  disabled: boolean;
  onSubmit(code: string): void;
}

/** The code asked before the form of an event that has one (FRM-002); the server checks it (EVT-012). */
export function AccessCodeScreen({ title, message, disabled, onSubmit }: AccessCodeScreenProps) {
  const t = useTranslations();
  const [code, setCode] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit(code);
  }

  return (
    <form data-testid="access-code-form" noValidate onSubmit={submit} className="py-6">
      <h1 data-testid="event-form-title" className="text-2xl font-bold" style={HEADING_STYLE}>
        {title}
      </h1>
      <p className="mt-3">{t("eventForm.code.intro")}</p>
      <fieldset disabled={disabled} className="mt-6">
        <label htmlFor="access-code" className="block font-medium">
          {t("eventForm.code.label")}
        </label>
        <input
          id="access-code"
          data-testid="access-code-input"
          type="text"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          className={`mt-1 ${INPUT_CLASS}`}
          style={INPUT_STYLE}
          aria-invalid={message ? true : undefined}
          aria-describedby={message ? "access-code-message" : undefined}
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
        {message && (
          <p id="access-code-message" role="alert" data-testid="access-code-message" className="mt-2 text-sm font-medium">
            {t(message)}
          </p>
        )}
        <button
          type="submit"
          data-testid="access-code-submit"
          className="mt-6 w-full px-5 py-3 font-semibold"
          style={BUTTON_STYLE}
        >
          {t("eventForm.code.submit")}
        </button>
      </fieldset>
    </form>
  );
}
