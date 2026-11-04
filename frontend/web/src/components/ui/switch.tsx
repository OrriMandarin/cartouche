"use client";

import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";

import { cn } from "@/lib/utils";

function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer data-[state=checked]:bg-app-primary data-[state=unchecked]:bg-app-border-strong relative inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full border-0 p-0 transition-colors outline-none before:absolute before:-inset-2.5 before:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-ring)] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="bg-app-surface shadow-app-sm pointer-events-none block size-5 rounded-full transition-transform motion-reduce:transition-none data-[state=checked]:translate-x-[18px] data-[state=unchecked]:translate-x-[2px]"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
