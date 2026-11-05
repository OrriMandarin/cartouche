import * as React from "react";

import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "border-app-border-strong bg-app-surface text-app-text placeholder:text-app-muted rounded-app flex field-sizing-content min-h-24 w-full border px-3 py-2.5 text-[15px] leading-[1.35] disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-ring)]",
        "aria-invalid:border-app-danger aria-invalid:border-2 aria-invalid:px-[11px] aria-invalid:py-[9px]",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
