import { Contact, LifeBuoy, User, Users, type LucideIcon } from "lucide-react";
import type { NavKey } from "@/lib/shell/nav";

export const NAV_ICONS: Record<NavKey, LucideIcon> = { cards: Contact, contacts: Users, account: User, support: LifeBuoy };
