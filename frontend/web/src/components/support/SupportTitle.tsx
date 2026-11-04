import type { ReactNode } from "react";

/** The heading of a support page: on a phone the app bar already says it, so it is only read aloud there. */
export function SupportTitle({ children }: { children: ReactNode }) {
  return (
    <h1 className="text-[28px] leading-[1.2] font-bold tracking-[-0.02em] @max-[847px]:sr-only">{children}</h1>
  );
}
