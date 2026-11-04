import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

/** The quiet link above the title of a support sub-page that leads one level up (the data-testid is `support-back`). */
export function SupportBackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      data-testid="support-back"
      className="text-app-muted hover:text-app-text focus-visible:outline-app-ring inline-flex min-h-11 w-fit items-center gap-1.5 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      <ArrowLeft aria-hidden="true" className="size-4" />
      {children}
    </Link>
  );
}
