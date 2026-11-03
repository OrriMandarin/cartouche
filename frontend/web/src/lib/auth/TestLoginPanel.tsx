"use client";

import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "./context";
import { BASE_TEST_USERS } from "./test-users";

/** spec: ACC-015. One button per user of the `base` scenario, plus a free-subject form. */
export function TestLoginPanel() {
  const t = useTranslations("auth");
  const { signIn } = useAuth();
  const [subject, setSubject] = useState("");
  const [failed, setFailed] = useState(false);

  async function login(value: string) {
    setFailed(false);
    try {
      await signIn({ subject: value });
    } catch {
      setFailed(true);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (subject.trim() !== "") void login(subject);
  }

  return (
    <section className="flex w-full max-w-sm flex-col gap-4">
      <h2 className="text-lg font-semibold">{t("test.heading")}</h2>
      <p className="text-muted-foreground text-sm">{t("test.description")}</p>
      <ul className="flex flex-col gap-2">
        {BASE_TEST_USERS.map((user) => (
          <li key={user.subject}>
            <Button
              variant="outline"
              className="w-full justify-between"
              data-testid={`login-as-${user.subject}`}
              onClick={() => void login(user.subject)}
            >
              <span>{user.name}</span>
              <span className="text-muted-foreground text-xs">{user.subject}</span>
            </Button>
          </li>
        ))}
      </ul>
      <form onSubmit={onSubmit} className="flex flex-col gap-2">
        <label htmlFor="login-free-subject" className="text-sm font-medium">
          {t("test.freeSubject")}
        </label>
        <input
          id="login-free-subject"
          data-testid="login-free-subject"
          className="border-input bg-background rounded-md border px-3 py-2 text-sm"
          value={subject}
          placeholder={t("test.freeSubjectPlaceholder")}
          onChange={(event) => setSubject(event.target.value)}
        />
        <Button type="submit" data-testid="login-free-subject-submit">
          {t("test.submit")}
        </Button>
      </form>
      {failed ? (
        <p role="alert" data-testid="login-error" className="text-destructive text-sm">
          {t("login.error")}
        </p>
      ) : null}
    </section>
  );
}
