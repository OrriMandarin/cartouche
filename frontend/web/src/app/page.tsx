import { useTranslations } from "next-intl";
import Link from "next/link";
import { Button } from "@/components/ui/button";

// Placeholder: the real landing page comes with plan 6.
export default function HomePage() {
  const t = useTranslations("landing");

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-6 px-4 text-center">
      <h1 className="text-4xl font-bold tracking-tight">{t("title")}</h1>
      <p className="text-muted-foreground text-lg">{t("tagline")}</p>
      <Button asChild>
        <Link href="/login">{t("signIn")}</Link>
      </Button>
    </main>
  );
}
