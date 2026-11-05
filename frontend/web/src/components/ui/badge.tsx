import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-[3px] text-[13px] leading-[1.3] font-semibold w-fit whitespace-nowrap shrink-0 gap-1.5 before:size-[7px] before:shrink-0 before:rounded-full before:bg-current before:content-['']",
  {
    variants: {
      variant: {
        success: "bg-app-success-soft text-app-success",
        neutral: "bg-app-neutral-soft text-app-neutral",
        warning: "bg-app-warning-soft text-app-warning",
        danger: "bg-app-danger-soft text-app-danger",
        info: "bg-app-info-soft text-app-info",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  },
);

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span";

  return <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
