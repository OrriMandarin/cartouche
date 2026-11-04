"use client";

import { ArrowLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { BrandMark } from "./BrandMark";

export type Crumb = { label: string; href?: string; testId?: string };
export type BackAction = { href: string; label: string };

/**
 * Top of the main area. On a computer (68 px): the breadcrumb of the card screens, nothing elsewhere.
 * On a phone (56 px): back, title and an optional action.
 */
export function TopBar({
  breadcrumb,
  breadcrumbTail,
  actions,
  title,
  back,
  action,
}: {
  breadcrumb?: Crumb[] | undefined;
  breadcrumbTail?: ReactNode;
  actions?: ReactNode;
  title?: string | undefined;
  back?: BackAction | undefined;
  action?: ReactNode;
}) {
  const t = useTranslations("shell");
  return (
    <>
      {breadcrumb && breadcrumb.length > 0 ? (
        <div className="border-app-border hidden min-h-[68px] items-center justify-between gap-4 border-b pr-6 pl-10 @min-[848px]:flex">
          <nav aria-label={t("breadcrumbLabel")} className="text-app-muted flex min-w-0 items-center gap-1.5 text-sm">
            {breadcrumb.map((crumb, index) => (
              <Fragment key={`${index}-${crumb.label}`}>
                {index > 0 ? <ChevronRight aria-hidden="true" className="size-4" /> : null}
                {crumb.href ? (
                  <Link href={crumb.href} data-testid={crumb.testId} className="flex-none whitespace-nowrap underline underline-offset-3">
                    {crumb.label}
                  </Link>
                ) : (
                  <span aria-current="page" data-testid={crumb.testId} className="text-app-text min-w-[4rem] truncate font-semibold">
                    {crumb.label}
                  </span>
                )}
              </Fragment>
            ))}
            {breadcrumbTail}
          </nav>
          {actions ? <div className="flex flex-none items-center gap-2.5">{actions}</div> : null}
        </div>
      ) : null}
      <div className="bg-app-surface border-app-border sticky top-0 z-10 flex min-h-14 items-center gap-1 border-b pr-1.5 pl-2 @min-[848px]:hidden">
        {back ? (
          <Link
            href={back.href}
            data-testid="shell-back"
            aria-label={back.label}
            className="rounded-app grid size-11 flex-none place-items-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-primary"
          >
            <ArrowLeft aria-hidden="true" className="size-5" />
          </Link>
        ) : (
          <span className="grid size-11 flex-none place-items-center">
            <BrandMark className="size-[26px]" />
          </span>
        )}
        <span data-testid="shell-title" className="min-w-0 flex-1 truncate px-1.5 text-[17px] font-semibold">
          {title}
        </span>
        {action}
      </div>
    </>
  );
}
