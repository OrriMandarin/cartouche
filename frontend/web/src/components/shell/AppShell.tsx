"use client";

import { usePathname } from "next/navigation";
import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from "react";
import { SideNav, type ShellUser } from "./SideNav";
import { TabBar } from "./TabBar";
import { TopBar, type BackAction, type Crumb } from "./TopBar";
import { currentNavKey } from "@/lib/shell/nav";

export type ShellSlots = {
  /** Breadcrumb of the card screens (computer top bar). */
  breadcrumb?: Crumb[] | undefined;
  /** Title of the phone app bar. */
  title?: string | undefined;
  /** Back action of the phone app bar. */
  back?: BackAction | undefined;
  /** Action at the right of the phone app bar. */
  action?: ReactNode;
  /** Right side of the computer top bar: the status and the buttons of an editor. */
  topBarActions?: ReactNode;
  /** After the breadcrumb of the computer top bar, such as the public link of the card. */
  breadcrumbTail?: ReactNode;
  /** Replaces the tab bar on phones: the sticky « Enregistrer » bar of the editors. */
  saveBar?: ReactNode;
  /** The page fills the main area edge to edge, without the content width and margins (the card editor). */
  fullBleed?: boolean | undefined;
};

const ShellSlotsContext = createContext<((slots: ShellSlots) => void) | null>(null);

/**
 * Lets a page below the shell fill its slots from its own state, such as an editor's save bar that follows
 * the draft. What it sets replaces the slots the page gave the shell, until it unmounts.
 */
export function useShellSlots(slots: ShellSlots): void {
  const setSlots = useContext(ShellSlotsContext);
  // Every render: the slots hold elements built from the caller's latest state.
  useLayoutEffect(() => {
    setSlots?.(slots);
  });
  useLayoutEffect(() => () => setSlots?.({}), [setSlots]);
}

/**
 * Frame of the dashboard. One markup for computers and phones, rearranged by a container query on the
 * shell itself: the side bar appears once the main area can be 600 px wide (248 + 600), below that the
 * app bar and the bottom tab bar (or `saveBar`) take over.
 */
export function AppShell({
  user,
  isAdmin = false,
  onSignOut,
  children,
  ...pageSlots
}: ShellSlots & { user: ShellUser; isAdmin?: boolean; onSignOut: () => void; children: ReactNode }) {
  const current = currentNavKey(usePathname());
  const [ownSlots, setOwnSlots] = useState<ShellSlots>({});
  const slots = { ...pageSlots, ...withoutUndefined(ownSlots) };
  return (
    <ShellSlotsContext.Provider value={setOwnSlots}>
      <div className="@container">
        <div className="grid min-h-dvh grid-cols-1 @min-[848px]:grid-cols-[248px_minmax(0,1fr)]">
          <SideNav current={current} user={user} isAdmin={isAdmin} onSignOut={onSignOut} />
          <div className="flex min-w-0 flex-col">
            <TopBar
              breadcrumb={slots.breadcrumb}
              breadcrumbTail={slots.breadcrumbTail}
              actions={slots.topBarActions}
              title={slots.title}
              back={slots.back}
              action={slots.action}
            />
            <main
              className={
                slots.fullBleed
                  ? "flex w-full min-w-0 flex-1 flex-col"
                  : "mx-auto flex w-full max-w-[1160px] flex-1 flex-col px-4 py-4 @min-[848px]:px-10 @min-[848px]:pt-8 @min-[848px]:pb-12"
              }
            >
              {children}
            </main>
            {slots.saveBar ? (
              <div className="bg-app-surface border-app-border sticky bottom-0 z-10 border-t @min-[848px]:hidden">
                {slots.saveBar}
              </div>
            ) : (
              <TabBar current={current} isAdmin={isAdmin} />
            )}
          </div>
        </div>
      </div>
    </ShellSlotsContext.Provider>
  );
}

function withoutUndefined(slots: ShellSlots): ShellSlots {
  return Object.fromEntries(Object.entries(slots).filter(([, value]) => value !== undefined));
}
