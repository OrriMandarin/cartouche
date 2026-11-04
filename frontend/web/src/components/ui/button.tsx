import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-app border border-transparent text-[15px] font-semibold leading-none transition-colors disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-5 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-ring)]",
  {
    variants: {
      variant: {
        default: "bg-app-primary text-app-on-primary hover:bg-[var(--app-primary-hover)]",
        destructive: "bg-app-danger text-[var(--app-on-danger)] hover:bg-app-danger/90",
        dangerGhost: "text-app-danger hover:bg-app-danger-soft",
        outline: "bg-app-surface border-app-border shadow-app-sm hover:bg-app-surface-2",
        secondary: "bg-app-surface border-app-border shadow-app-sm hover:bg-app-surface-2",
        ghost: "hover:bg-app-surface-2",
        link: "text-app-text underline underline-offset-4 hover:no-underline",
      },
      size: {
        default: "min-h-11 px-4",
        sm: "min-h-11 gap-1.5 px-3.5",
        lg: "min-h-12 px-6",
        icon: "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
