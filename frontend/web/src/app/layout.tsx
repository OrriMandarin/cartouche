import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { TestModeBanner, isTestModeProfile } from "@/components/TestModeBanner";
import { cn } from "@/lib/utils";
import "@/lib/theme/fonts.css";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("landing");
  return { title: t("title"), description: t("tagline") };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();

  return (
    <html lang={locale}>
      {/* The banner is fixed to the top: reserve its height so it never covers content. */}
      <body
        className={cn(
          "min-h-screen font-sans antialiased",
          isTestModeProfile(process.env.NEXT_PUBLIC_CARTOUCHE_BUILD_PROFILE) && "pt-6",
        )}
      >
        <NextIntlClientProvider>
          <TestModeBanner />
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
