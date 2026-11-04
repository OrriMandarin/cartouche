"use client";

import { useEffect } from "react";

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

/**
 * spec: EDI-016, EDI-021. While `dirty`, leaving the page asks first: the browser asks before closing,
 * reloading or leaving the site, and a click on any internal link of the page, whoever renders it (the
 * editor itself, the page header), asks with `message`. A refusal cancels the click.
 */
export function useLeaveGuard(dirty: boolean, message: string): void {
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    // Capture phase: the guard runs before the link's own handler (the router) sees the click.
    const confirmLink = (event: MouseEvent) => {
      if (!leavingLink(event) || window.confirm(message)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", confirmLink, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", confirmLink, true);
    };
  }, [dirty, message]);
}
