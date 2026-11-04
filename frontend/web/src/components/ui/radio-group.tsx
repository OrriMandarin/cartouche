"use client";

import * as React from "react";
import * as RadioPrimitive from "@radix-ui/react-radio-group";

import { cn } from "@/lib/utils";

/** The segmented control of the design: a track of options, the checked one lifted on a surface. */
function RadioGroup({ className, ...props }: React.ComponentProps<typeof RadioPrimitive.Root>) {
  return (
    <RadioPrimitive.Root
      data-slot="radio-group"
      className={cn("bg-app-surface-2 rounded-app inline-flex gap-0.5 p-[3px]", className)}
      {...props}
    />
  );
}

function RadioGroupItem({ className, ...props }: React.ComponentProps<typeof RadioPrimitive.Item>) {
  return (
    <RadioPrimitive.Item
      data-slot="radio-group-item"
      className={cn(
        "text-app-muted inline-flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-3.5 text-sm font-semibold",
        "data-[state=checked]:bg-app-surface data-[state=checked]:text-app-text data-[state=checked]:shadow-app-sm",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-ring)] disabled:cursor-not-allowed disabled:opacity-45",
        className,
      )}
      {...props}
    />
  );
}

export { RadioGroup, RadioGroupItem };
