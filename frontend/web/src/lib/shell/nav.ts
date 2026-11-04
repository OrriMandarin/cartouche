export type NavKey = "cards" | "contacts" | "account";

export const NAV_ENTRIES: ReadonlyArray<{ key: NavKey; href: string }> = [
  { key: "cards", href: "/dashboard" },
  { key: "contacts", href: "/dashboard/contacts" },
  { key: "account", href: "/dashboard/account" },
];

/** The navigation entry a dashboard path belongs to: every page of a card belongs to « Mes cartes ». */
export function currentNavKey(pathname: string): NavKey | null {
  if (pathname === "/dashboard/contacts" || pathname.startsWith("/dashboard/contacts/")) return "contacts";
  if (pathname === "/dashboard/account" || pathname.startsWith("/dashboard/account/")) return "account";
  if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) return "cards";
  return null;
}
