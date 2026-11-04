"use client";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import type { EditorSection } from "@/lib/cards/section-summary";
import { cn } from "@/lib/utils";

/** The phone editor hides what is folded; a computer always shows every section. */
const FOLDED = "@max-[847px]:hidden";

export function sectionAnchor(section: EditorSection): string {
  return `section-${section}`;
}

/** The anchor tabs of the computer editor and the section each one leads to. */
export const SECTION_TABS = [
  { key: "identity", section: "identity" },
  { key: "contact", section: "contact" },
  { key: "links", section: "links" },
  { key: "media", section: "media" },
  { key: "appearance", section: "template" },
] as const satisfies readonly { key: string; section: EditorSection }[];

export type SectionTab = (typeof SECTION_TABS)[number]["key"];

/** spec: EDI-003. Anchor tabs above the computer form: Identité · Coordonnées · Liens · Médias · Apparence. */
export function EditorSectionTabs({ current, onSelect }: { current: SectionTab; onSelect: (tab: SectionTab) => void }) {
  const t = useTranslations("editor.tabs");
  return (
    <nav
      aria-label={t("label")}
      className="border-app-border hidden gap-1 overflow-x-auto border-b @min-[848px]:flex"
    >
      {SECTION_TABS.map(({ key, section }) => (
        <a
          key={key}
          href={`#${sectionAnchor(section)}`}
          aria-current={current === key ? "true" : undefined}
          onClick={() => onSelect(key)}
          className={cn(
            "-mb-px inline-flex min-h-11 items-center border-b-2 border-transparent px-3 text-sm font-semibold whitespace-nowrap",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-ring)]",
            current === key ? "text-app-text border-app-text" : "text-app-muted",
          )}
        >
          {t(key)}
        </a>
      ))}
    </nav>
  );
}

/**
 * spec: EDI-003. One section of the card editor. On a computer, a card with its title; on a phone, a row
 * that folds and unfolds, with a summary of what it holds while folded. A read-only editor (LNK-036)
 * disables every control of the section, but its row still folds.
 */
export function EditorSectionPanel({
  section,
  title,
  summary,
  note,
  open,
  onToggle,
  readOnly,
  children,
}: {
  section: EditorSection;
  title: string;
  /** What the section holds, in short (`sectionSummary`), shown while folded on a phone. */
  summary: string;
  /** Shown at the right of the title on a computer. */
  note?: ReactNode;
  open: boolean;
  onToggle: () => void;
  readOnly: boolean;
  children: ReactNode;
}) {
  const id = sectionAnchor(section);
  const titleId = `${id}-title`;
  const bodyId = `${id}-body`;
  return (
    <section
      id={id}
      aria-labelledby={titleId}
      data-testid={`editor-section-${section}`}
      className="bg-app-surface border-app-border scroll-mt-4 border-b @min-[848px]:rounded-app-lg @min-[848px]:shadow-app-sm @min-[848px]:border"
    >
      <h2 className="text-base leading-[1.35] font-semibold">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          data-testid={`editor-section-toggle-${section}`}
          onClick={onToggle}
          className="flex min-h-16 w-full items-center gap-3 py-2.5 pr-3 pl-4 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--app-ring)] @min-[848px]:hidden"
        >
          <span className="flex min-w-0 flex-1 flex-col">
            <span>{title}</span>
            {open ? null : (
              <span className="text-app-muted truncate text-[13px] leading-[1.4] font-normal">{summary}</span>
            )}
          </span>
          <ChevronDown
            aria-hidden="true"
            className={cn("text-app-muted size-5 flex-none motion-safe:transition-transform", open && "rotate-180")}
          />
        </button>
        <span className="hidden items-baseline justify-between gap-3 px-6 pt-6 @min-[848px]:flex">
          <span id={titleId}>{title}</span>
          {note ? <span className="text-app-muted text-[13px] leading-[1.4] font-normal">{note}</span> : null}
        </span>
      </h2>
      <div
        id={bodyId}
        data-testid={`editor-section-body-${section}`}
        className={cn("px-4 pt-1 pb-5 @min-[848px]:px-6 @min-[848px]:pt-[18px] @min-[848px]:pb-6", !open && FOLDED)}
      >
        <fieldset disabled={readOnly} className="m-0 flex min-w-0 flex-col gap-[18px] border-0 p-0">
          {children}
        </fieldset>
      </div>
    </section>
  );
}
