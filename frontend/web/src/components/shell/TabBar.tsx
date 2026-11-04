"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { NAV_ICONS } from "./navItems";
import { NAV_ENTRIES, type NavKey } from "@/lib/shell/nav";

/** Bottom tab bar of the phone layout, with the same three entries as the side bar. */
export function TabBar({ current }: { current: NavKey | null }) {
  const t = useTranslations("shell");
  return (
    <nav
      aria-label={t("navLabel")}
      className="bg-app-surface border-app-border sticky bottom-0 z-10 grid grid-cols-3 border-t px-2 pt-1.5 pb-2.5 @min-[848px]:hidden"
    >
      {NAV_ENTRIES.map(({ key, href }) => {
        const Icon = NAV_ICONS[key];
        const active = current === key;
        return (
          <Link
            key={key}
            href={href}
            data-testid={`tab-${key}`}
            {...(active ? { "aria-current": "page" as const } : {})}
            className={`flex min-h-[52px] flex-col items-center justify-center gap-0.5 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-primary ${
              active ? "text-app-text" : "text-app-muted"
            }`}
          >
            <span className={`grid h-[30px] w-14 place-items-center rounded-full ${active ? "bg-app-surface-2" : ""}`}>
              <Icon aria-hidden="true" className={`size-5 ${active ? "text-app-brand" : ""}`} />
            </span>
            {t(key)}
          </Link>
        );
      })}
    </nav>
  );
}
