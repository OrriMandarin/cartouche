"use client";

import * as React from "react";
import * as SheetPrimitive from "@radix-ui/react-dialog";
import { XIcon } from "lucide-react";

import { cn } from "@/lib/utils";

const Sheet = SheetPrimitive.Root;
const SheetTrigger = SheetPrimitive.Trigger;
const SheetClose = SheetPrimitive.Close;

/** A panel that slides in from the right edge, or rises from the bottom on small screens. */
function SheetContent({
  className,
  children,
  closeLabel,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & { closeLabel: string }) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay
        data-slot="sheet-overlay"
        className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-[var(--app-scrim)]"
      />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          "bg-app-surface text-app-text font-app shadow-app-lg fixed z-50 flex flex-col gap-4 p-6 outline-hidden motion-reduce:animate-none",
          "data-[state=open]:animate-in data-[state=closed]:animate-out duration-200",
          "inset-x-0 bottom-0 max-h-[90dvh] overflow-y-auto rounded-t-app-xl data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom",
          "md:inset-y-0 md:right-0 md:left-auto md:max-h-none md:w-[420px] md:rounded-t-none md:rounded-l-app-xl md:data-[state=open]:slide-in-from-right md:data-[state=closed]:slide-out-to-right",
          className,
        )}
        {...props}
      >
        {children}
        <SheetPrimitive.Close className="text-app-text hover:bg-app-surface-2 rounded-app absolute top-3 right-3 grid size-11 place-items-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-ring)]">
          <XIcon className="size-5" aria-hidden="true" />
          <span className="sr-only">{closeLabel}</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="sheet-header" className={cn("flex flex-col gap-1.5 pr-10", className)} {...props} />;
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="sheet-footer" className={cn("mt-auto flex flex-wrap justify-end gap-2.5", className)} {...props} />
  );
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("text-xl leading-[1.3] font-[650] tracking-[-0.01em]", className)}
      {...props}
    />
  );
}

function SheetDescription({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-app-muted text-sm", className)}
      {...props}
    />
  );
}

export { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger };
