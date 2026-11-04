"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

/** The internal link a click went through, if it is one that leaves the current page. */
function leavingLink(event: MouseEvent): HTMLAnchorElement | null {
  if (!(event.target instanceof Element)) return null;
  const link = event.target.closest("a[href]");
  if (!(link instanceof HTMLAnchorElement)) return null;
  if (link.target === "_blank" || link.hasAttribute("download")) return null;
  const destination = new URL(link.href, window.location.href);
  if (destination.origin !== window.location.origin) return null;
  const samePage =
    destination.pathname === window.location.pathname && destination.search === window.location.search;
  return samePage ? null : link;
}

export type LeaveGuard = {
  /** A navigation is waiting for the owner's choice: the leave dialog is open. */
  asking: boolean;
  /** « Enregistrer et quitter » is saving. */
  saving: boolean;
  /** « Rester ». */
  stay: () => void;
  /** « Quitter sans enregistrer ». */
  leave: () => void;
  /** « Enregistrer et quitter »: leaves only once the save succeeded; a refused save closes the dialog. */
  saveAndLeave: () => Promise<void>;
};

/**
 * spec: EDI-016, EDI-021, EDI-028. While `dirty`, leaving the page asks first: the browser asks before closing,
 * reloading or leaving the site, and a click on any internal link of the page, whoever renders it (the editor,
 * the shell's navigation), is held back and opens the leave dialog. `save` reports whether the save succeeded.
 */
export function useLeaveGuard({ dirty, save }: { dirty: boolean; save: () => Promise<boolean> }): LeaveGuard {
  const router = useRouter();
  const [destination, setDestination] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    // Capture phase: the guard runs before the link's own handler (the router) sees the click.
    const holdLink = (event: MouseEvent) => {
      const link = leavingLink(event);
      if (!link) return;
      event.preventDefault();
      event.stopPropagation();
      setDestination(link.pathname + link.search + link.hash);
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", holdLink, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", holdLink, true);
    };
  }, [dirty]);

  const stay = useCallback(() => setDestination(null), []);

  const leave = useCallback(() => {
    if (destination === null) return;
    setDestination(null);
    router.push(destination);
  }, [destination, router]);

  const saveAndLeave = useCallback(async () => {
    if (destination === null || saving) return;
    setSaving(true);
    try {
      const saved = await saveRef.current();
      setDestination(null);
      if (saved) router.push(destination);
    } finally {
      setSaving(false);
    }
  }, [destination, router, saving]);

  return { asking: destination !== null, saving, stay, leave, saveAndLeave };
}
