export type NavKey = "cards" | "contacts" | "account" | "support";

export type NavEntry = { key: NavKey; href: string };

const USER_ENTRIES: ReadonlyArray<NavEntry> = [
  { key: "cards", href: "/dashboard" },
  { key: "contacts", href: "/dashboard/contacts" },
  { key: "account", href: "/dashboard/account" },
];

const SUPPORT_ENTRY: NavEntry = { key: "support", href: "/support" };

/** spec: ADM-001. The navigation entries: « Support » is for administrators only, after « Mon compte ». */
export function navEntries(isAdmin: boolean): ReadonlyArray<NavEntry> {
  return isAdmin ? [...USER_ENTRIES, SUPPORT_ENTRY] : USER_ENTRIES;
}

/** The navigation entry a path belongs to: every page of a card belongs to « Mes cartes », every support page to « Support ». */
export function currentNavKey(pathname: string): NavKey | null {
  if (pathname === "/support" || pathname.startsWith("/support/")) return "support";
  if (pathname === "/dashboard/contacts" || pathname.startsWith("/dashboard/contacts/")) return "contacts";
  if (pathname === "/dashboard/account" || pathname.startsWith("/dashboard/account/")) return "account";
  if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) return "cards";
  return null;
}
