import { useTranslations } from "next-intl";

/** A slug that was never attributed (LNK-023); the status is 404. */
export default function CardNotFound() {
  const t = useTranslations("publicCard");

  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center justify-center px-4 text-center">
      <p data-testid="card-not-found" className="text-muted-foreground text-lg">
        {t("notFound")}
      </p>
    </main>
  );
}
