"use client";

import { Toaster as Sonner } from "sonner";

/** Toasts of the dashboard: dark, bottom-centre. Triggered through `lib/toast.ts`, never through Sonner directly. */
export function Toaster() {
  return (
    <Sonner
      position="bottom-center"
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "bg-app-primary text-app-on-primary font-app shadow-app rounded-app-lg flex min-h-14 w-[min(420px,calc(100vw-2rem))] items-center gap-3 py-1.5 pr-1.5 pl-4 text-sm font-medium",
          title: "flex-1",
          actionButton:
            "text-app-on-primary min-h-11 cursor-pointer rounded-app px-3 text-sm font-semibold hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
        },
      }}
    />
  );
}
