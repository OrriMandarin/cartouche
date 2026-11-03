import { useTranslations } from "next-intl";

/** The neutral page of a card that is not served (LNK-006, LNK-027): the same for every reason, no card data. */
export function InactiveCard() {
  const t = useTranslations("publicCard");

  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center justify-center px-4 text-center">
      <p data-testid="card-inactive" className="text-muted-foreground text-lg">
        {t("inactive")}
      </p>
    </main>
  );
}
