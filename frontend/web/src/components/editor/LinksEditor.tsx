"use client";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragCancelEvent,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, GripVertical, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { createElement, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MAX_LINKS, type DraftLink } from "@/lib/cards/draft";
import { announcement, moveItem } from "@/lib/cards/reorder";
import { cn } from "@/lib/utils";
import { LINK_KINDS, type LinkKind } from "@/templates/contract";
import { linkIcon } from "@/templates/link-display";
import { describedBy, FieldMessage } from "./Field";

const NETWORK_KINDS = LINK_KINDS.filter((kind) => kind !== "custom");

type Translate = (key: string, values?: Record<string, string | number>) => string;

interface RowProps {
  id: string;
  index: number;
  link: DraftLink;
  name: string;
  errors: Record<string, string>;
  t: Translate;
  onEdit: (index: number, patch: Partial<DraftLink>) => void;
  onMove: (index: number, by: -1 | 1) => void;
  onRemove: (index: number) => void;
}

/** One link: its handle, its icon, its fields and its removal. A free link has a label of its own. */
function LinkRow({ id, index, link, name, errors, t, onEdit, onMove, onRemove }: RowProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id, attributes: { roleDescription: t("roleDescription") } });
  const urlPath = `links[${index}].url`;
  const labelPath = `links[${index}].label`;
  const isFree = link.kind === "custom";
  // A network whose label was set by an earlier editor keeps a field to edit it.
  // Decided when the row appears, so that clearing the label does not remove the field being edited.
  const [keepsLabel] = useState(() => link.label !== "");
  const showsLabel = isFree || keepsLabel || Boolean(errors[labelPath]);

  function onHandleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const by = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (by !== 0 && !isDragging) {
      event.preventDefault();
      onMove(index, by);
      return;
    }
    listeners?.onKeyDown?.(event);
  }

  const urlField = (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <Label htmlFor={`link-url-${index}`}>{isFree ? t("url") : name}</Label>
      <Input
        id={`link-url-${index}`}
        data-testid={`link-url-${index}`}
        type="url"
        inputMode="url"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        placeholder="https://"
        value={link.url}
        aria-invalid={errors[urlPath] ? true : undefined}
        aria-describedby={describedBy(urlPath, errors[urlPath])}
        onChange={(event) => onEdit(index, { url: event.target.value })}
      />
      <FieldMessage path={urlPath} message={errors[urlPath]} />
    </div>
  );
  const labelField = showsLabel ? (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <Label htmlFor={`link-label-${index}`}>{t("label")}</Label>
      <Input
        id={`link-label-${index}`}
        data-testid={`link-label-${index}`}
        autoComplete="off"
        value={link.label}
        aria-invalid={errors[labelPath] ? true : undefined}
        aria-describedby={describedBy(labelPath, errors[labelPath])}
        onChange={(event) => onEdit(index, { label: event.target.value })}
      />
      <FieldMessage path={labelPath} message={errors[labelPath]} />
    </div>
  ) : null;

  return (
    <li
      ref={setNodeRef}
      data-testid={`link-row-${index}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "bg-app-surface border-app-border rounded-app-lg flex items-start gap-2 border p-2",
        isDragging && "shadow-app-lg relative z-10 opacity-90",
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        id={`link-handle-${index}`}
        data-testid={`link-handle-${index}`}
        ref={setActivatorNodeRef}
        aria-label={t("move", { name })}
        className="mt-[22px] cursor-grab touch-none"
        {...attributes}
        {...listeners}
        onKeyDown={onHandleKeyDown}
      >
        <GripVertical aria-hidden="true" />
      </Button>
      <span
        aria-hidden="true"
        className="bg-app-surface-2 text-app-text mt-[22px] grid size-11 flex-none place-items-center rounded-app [&_svg]:size-5"
      >
        {createElement(linkIcon(link.kind))}
      </span>
      <div className={cn("flex min-w-0 flex-1 gap-3", isFree ? "flex-col @min-[560px]:flex-row" : "flex-col")}>
        {labelField && isFree ? labelField : null}
        {urlField}
        {labelField && !isFree ? labelField : null}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        data-testid={`link-remove-${index}`}
        aria-label={t("remove", { name })}
        className="mt-[22px]"
        onClick={() => onRemove(index)}
      >
        <Trash2 aria-hidden="true" />
      </Button>
    </li>
  );
}

/** spec: EDI-029, PUB-012, PUB-022. The links of the card, in the order the owner chooses. */
export function LinksEditor({
  value,
  onChange,
  errors,
}: {
  value: DraftLink[];
  /** `fixed` lists the field paths this change corrects, so their messages can go. */
  onChange: (links: DraftLink[], fixed: string[]) => void;
  /** Translated messages by field path. */
  errors: Record<string, string>;
}) {
  const t = useTranslations("editor.links");
  const tAll = useTranslations();
  const tKinds = useTranslations("publicCard.links");
  const linkPaths = Object.keys(errors).filter((path) => path.startsWith("links"));
  const full = value.length >= MAX_LINKS;

  // Each row keeps an id of its own through moves, so that it stays the same element (and keeps its focus).
  const [ids, setIds] = useState<string[]>(() => value.map((_, index) => `link-${index}`));
  const nextId = useRef(value.length);
  const rowIds = value.map((_, index) => ids[index] ?? `link-outside-${index}`);
  const [announced, setAnnounced] = useState("");
  const focusAfter = useRef<string | null>(null);

  useEffect(() => {
    if (focusAfter.current === null) return;
    document.getElementById(focusAfter.current)?.focus();
    focusAfter.current = null;
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function nameOf(link: DraftLink, index: number): string {
    if (link.label) return link.label;
    return link.kind === "custom" ? t("customName", { index: index + 1 }) : tKinds(link.kind);
  }

  function commit(links: DraftLink[], nextIds: string[]) {
    setIds(nextIds);
    onChange(links, linkPaths);
  }

  function add(kind: LinkKind) {
    const id = `link-${nextId.current++}`;
    focusAfter.current = `link-${kind === "custom" ? "label" : "url"}-${value.length}`;
    commit([...value, { kind, url: "", label: "" }], [...rowIds, id]);
  }

  function edit(index: number, patch: Partial<DraftLink>) {
    const fixed = Object.keys(patch).map((key) => `links[${index}].${key}`);
    onChange(value.map((link, i) => (i === index ? { ...link, ...patch } : link)), fixed);
  }

  function remove(index: number) {
    commit(
      value.filter((_, i) => i !== index),
      rowIds.filter((_, i) => i !== index),
    );
  }

  function move(from: number, to: number, announce = true) {
    if (to < 0 || to >= value.length) return;
    const moved = value[from]!;
    if (announce) setAnnounced(announcement(tAll, nameOf(moved, from), to + 1, value.length));
    focusAfter.current = `link-handle-${to}`;
    commit(moveItem(value, from, to), moveItem(rowIds, from, to));
  }

  function nameOfId(id: string | number): string {
    const index = rowIds.indexOf(String(id));
    return index < 0 ? "" : nameOf(value[index]!, index);
  }

  /** The moved link's name and the place of the link it is over. */
  function positionOf(movedId: string | number, overId: string | number): string {
    return announcement(tAll, nameOfId(movedId), rowIds.indexOf(String(overId)) + 1, value.length);
  }

  const announcements = {
    onDragStart: ({ active }: DragStartEvent) => t("dragStart", { name: nameOfId(active.id) }),
    onDragOver: ({ active, over }: DragOverEvent) => (over ? positionOf(active.id, over.id) : undefined),
    onDragEnd: ({ active, over }: DragEndEvent) => (over ? positionOf(active.id, over.id) : undefined),
    onDragCancel: ({ active }: DragCancelEvent) => t("dragCancel", { name: nameOfId(active.id) }),
  };

  function onDragEnd({ active, over }: DragEndEvent) {
    if (over === null || active.id === over.id) return;
    // dnd-kit announces the drop itself (see `announcements`).
    move(rowIds.indexOf(String(active.id)), rowIds.indexOf(String(over.id)), false);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-app-muted text-sm">{t("hint")}</p>
      {value.length === 0 ? <p className="text-app-muted text-sm">{t("empty")}</p> : null}
      <FieldMessage path="links" message={errors.links} />
      <p className="sr-only" aria-live="polite" data-testid="links-live">
        {announced}
      </p>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
        accessibility={{ announcements, screenReaderInstructions: { draggable: t("hint") } }}
      >
        <SortableContext items={rowIds} strategy={verticalListSortingStrategy}>
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {value.map((link, index) => (
              <LinkRow
                key={rowIds[index]}
                id={rowIds[index]!}
                index={index}
                link={link}
                name={nameOf(link, index)}
                errors={errors}
                t={t}
                onEdit={edit}
                onMove={(from, by) => move(from, from + by)}
                onRemove={remove}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      <div className="flex flex-wrap items-center gap-2.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="secondary" data-testid="link-add-network" disabled={full}>
              <Plus aria-hidden="true" />
              {t("addNetwork")}
              <ChevronDown aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {NETWORK_KINDS.map((kind) => (
              <DropdownMenuItem key={kind} data-testid={`link-add-network-${kind}`} onSelect={() => add(kind)}>
                {createElement(linkIcon(kind))}
                {tKinds(kind)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button type="button" variant="secondary" data-testid="link-add" disabled={full} onClick={() => add("custom")}>
          <Plus aria-hidden="true" />
          {t("addCustom")}
        </Button>
        {full ? <p className="text-app-muted text-sm">{t("max")}</p> : null}
      </div>
    </div>
  );
}
