import { useTranslations } from "next-intl";

/** An event that is unknown, deleted or of another card (FRM-024); the status is 404. */
export default function EventFormNotFound() {
  const t = useTranslations("eventForm");

  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center justify-center px-4 text-center">
      <p data-testid="event-form-not-found" className="text-muted-foreground text-lg">
        {t("notFound")}
      </p>
    </main>
  );
}
