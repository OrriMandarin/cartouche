"use client";

import { LogOut } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { BrandMark } from "./BrandMark";
import { NAV_ICONS } from "./navItems";
import { navEntries, type NavKey } from "@/lib/shell/nav";

export type ShellUser = { name: string; email?: string | null };

/** Side bar of the computer layout: brand, navigation, and the user at the bottom. */
export function SideNav({
  current,
  user,
  isAdmin,
  onSignOut,
}: {
  current: NavKey | null;
  user: ShellUser;
  isAdmin: boolean;
  onSignOut: () => void;
}) {
  const t = useTranslations("shell");
  return (
    <aside className="bg-app-surface border-app-border sticky top-0 hidden h-dvh flex-col gap-7 border-r px-3.5 py-5 @min-[848px]:flex">
      <span className="flex items-center gap-2.5 px-2.5 py-1.5 text-xl font-bold">
        <BrandMark />
        {t("brand")}
      </span>
      <nav aria-label={t("navLabel")} className="flex flex-col gap-0.5">
        {navEntries(isAdmin).map(({ key, href }) => {
          const Icon = NAV_ICONS[key];
          const active = current === key;
          return (
            <Link
              key={key}
              href={href}
              data-testid={key === "account" ? "account-link" : `nav-${key}`}
              {...(active ? { "aria-current": "page" as const } : {})}
              className={`rounded-app flex min-h-11 items-center gap-3 px-3 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-primary ${
                active ? "bg-app-surface-2 text-app-text font-semibold" : "text-app-muted hover:bg-app-surface-2"
              }`}
            >
              <Icon aria-hidden="true" className={`size-5 ${active ? "text-app-brand" : ""}`} />
              {t(key)}
            </Link>
          );
        })}
      </nav>
      <div className="border-app-border mt-auto flex items-center gap-2.5 border-t px-2.5 pt-3.5 text-sm leading-tight">
        <span
          aria-hidden="true"
          className="bg-app-surface-2 grid size-9 flex-none place-items-center rounded-full text-sm font-semibold"
        >
          {Array.from(user.name)[0]?.toUpperCase() ?? ""}
        </span>
        <span className="min-w-0 flex-1">
          <b data-testid="shell-user-name" className="block truncate font-semibold">
            {user.name}
          </b>
          {user.email ? (
            <span data-testid="shell-user-email" className="text-app-muted block truncate text-xs">
              {user.email}
            </span>
          ) : null}
        </span>
        <button
          type="button"
          data-testid="sign-out"
          aria-label={t("signOut")}
          title={t("signOut")}
          onClick={onSignOut}
          className="text-app-muted hover:bg-app-surface-2 rounded-app grid size-11 flex-none place-items-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-primary"
        >
          <LogOut aria-hidden="true" className="size-5" />
        </button>
      </div>
    </aside>
  );
}
