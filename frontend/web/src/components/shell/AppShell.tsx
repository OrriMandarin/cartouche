"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
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
  /** Replaces the tab bar on phones: the sticky « Enregistrer » bar of the editors. */
  saveBar?: ReactNode;
};

/**
 * Frame of the dashboard. One markup for computers and phones, rearranged by a container query on the
 * shell itself: the side bar appears once the main area can be 600 px wide (248 + 600), below that the
 * app bar and the bottom tab bar (or `saveBar`) take over.
 */
export function AppShell({
  user,
  onSignOut,
  children,
  ...slots
}: ShellSlots & { user: ShellUser; onSignOut: () => void; children: ReactNode }) {
  const current = currentNavKey(usePathname());
  return (
    <div className="@container">
      <div className="grid min-h-dvh grid-cols-1 @min-[848px]:grid-cols-[248px_minmax(0,1fr)]">
        <SideNav current={current} user={user} onSignOut={onSignOut} />
        <div className="flex min-w-0 flex-col">
          <TopBar breadcrumb={slots.breadcrumb} title={slots.title} back={slots.back} action={slots.action} />
          <main className="mx-auto flex w-full max-w-[1160px] flex-1 flex-col px-4 py-4 @min-[848px]:px-10 @min-[848px]:pt-8 @min-[848px]:pb-12">
            {children}
          </main>
          {slots.saveBar ? (
            <div className="bg-app-surface border-app-border sticky bottom-0 z-10 border-t @min-[848px]:hidden">
              {slots.saveBar}
            </div>
          ) : (
            <TabBar current={current} />
          )}
        </div>
      </div>
    </div>
  );
}
