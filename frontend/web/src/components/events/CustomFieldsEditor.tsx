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
import { ChevronDown, GripVertical, Plus, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { describedBy, FieldMessage } from "@/components/editor/Field";
import { OptionSelect } from "@/components/editor/OptionSelect";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { announcement } from "@/lib/cards/reorder";
import {
  type CustomFieldDraft,
  type EventDraft,
  addCustomField,
  addOption,
  changeCustomFieldKind,
  moveCustomField,
  removeCustomField,
  removeOption,
  setOption,
  updateCustomField,
} from "@/lib/events/draft";
import { CUSTOM_FIELD_KINDS, MAX_CUSTOM_FIELDS, MAX_OPTIONS } from "@/lib/events/fields";
import type { CustomFieldKind } from "@/lib/events/types";
import { cn } from "@/lib/utils";

type Translate = (key: string, values?: Record<string, string | number>) => string;
type Change = (draft: EventDraft, fixed: string[]) => void;

interface RowProps {
  index: number;
  draft: EventDraft;
  field: CustomFieldDraft;
  name: string;
  errors: Record<string, string>;
  t: Translate;
  /** « (facultatif) ». */
  tOptional: string;
  onChange: Change;
  onMove: (index: number, by: -1 | 1) => void;
}

/** One custom field: its handle, type, label, removal, choices, help text and required switch. */
function CustomFieldRow({ index, draft, field, name, errors, t, tOptional, onChange, onMove }: RowProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: field.id,
    attributes: { roleDescription: t("roleDescription") },
  });
  const path = `custom_fields[${index}]`;
  const labelPath = `${path}.label`;
  const helpPath = `${path}.help`;
  const optionsPath = `${path}.options`;

  function onHandleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const by = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (by !== 0 && !isDragging) {
      event.preventDefault();
      onMove(index, by);
      return;
    }
    listeners?.onKeyDown?.(event);
  }

  return (
    <li
      ref={setNodeRef}
      data-testid={`custom-field-${index}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "bg-app-surface border-app-border rounded-app-lg flex flex-col gap-3 border p-4 @max-[847px]:p-3",
        isDragging && "shadow-app-lg relative z-10 opacity-90",
      )}
    >
      <div className="grid grid-cols-[44px_210px_minmax(0,1fr)_44px] items-end gap-2.5 @max-[847px]:grid-cols-[44px_minmax(0,1fr)_44px]">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          id={`custom-handle-${index}`}
          data-testid={`custom-handle-${index}`}
          ref={setActivatorNodeRef}
          aria-label={t("move", { name })}
          className="text-app-muted cursor-grab touch-none"
          {...attributes}
          {...listeners}
          onKeyDown={onHandleKeyDown}
        >
          <GripVertical aria-hidden="true" />
        </Button>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={`custom-kind-${index}`}>{t("kind")}</Label>
          <OptionSelect
            id={`custom-kind-${index}`}
            testId={`custom-kind-${index}`}
            value={field.kind}
            options={CUSTOM_FIELD_KINDS.map((kind) => ({ value: kind, label: t(`kinds.${kind}`) }))}
            onValueChange={(kind) =>
              onChange(changeCustomFieldKind(draft, index, kind as CustomFieldKind), [optionsPath])
            }
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5 @max-[847px]:col-span-full @max-[847px]:row-start-2">
          <Label htmlFor={`custom-label-${index}`}>{t("label")}</Label>
          <Input
            id={`custom-label-${index}`}
            data-testid={`custom-label-${index}`}
            autoComplete="off"
            value={field.label}
            aria-invalid={errors[labelPath] ? true : undefined}
            aria-describedby={describedBy(labelPath, errors[labelPath])}
            onChange={(e) => onChange(updateCustomField(draft, index, { label: e.target.value }), [labelPath])}
          />
        </div>
        <Button
          type="button"
          variant="dangerGhost"
          size="icon"
          data-testid={`custom-remove-${index}`}
          aria-label={t("remove", { name })}
          className="@max-[847px]:col-start-3 @max-[847px]:row-start-1"
          onClick={() => onChange(removeCustomField(draft, index), ["custom_fields"])}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </div>
      <FieldMessage path={labelPath} message={errors[labelPath]} />

      {field.kind === "single_choice" ? (
        <div className="flex flex-col gap-2" role="group" aria-labelledby={`custom-options-${index}`}>
          <span id={`custom-options-${index}`} className="text-sm leading-none font-semibold">
            {t("options")}
          </span>
          <FieldMessage path={optionsPath} message={errors[optionsPath]} />
          <ul className="m-0 flex list-none flex-wrap items-start gap-2 p-0">
            {field.options.map((option, position) => {
              const optionPath = `${optionsPath}[${position}]`;
              return (
                <li key={position} className="flex flex-col gap-1">
                  <div className="flex items-center gap-1">
                    <Input
                      data-testid={`custom-option-${index}-${position}`}
                      aria-label={t("option", { index: position + 1 })}
                      autoComplete="off"
                      className="w-44"
                      value={option}
                      aria-invalid={errors[optionPath] ? true : undefined}
                      aria-describedby={describedBy(optionPath, errors[optionPath])}
                      onChange={(e) => onChange(setOption(draft, index, position, e.target.value), [optionsPath])}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      data-testid={`custom-option-remove-${index}-${position}`}
                      aria-label={t("removeOption", { index: position + 1 })}
                      onClick={() => onChange(removeOption(draft, index, position), [optionsPath])}
                    >
                      <X aria-hidden="true" />
                    </Button>
                  </div>
                  <FieldMessage path={optionPath} message={errors[optionPath]} />
                </li>
              );
            })}
            <li>
              <Button
                type="button"
                variant="secondary"
                data-testid={`custom-option-add-${index}`}
                disabled={field.options.length >= MAX_OPTIONS}
                onClick={() => onChange(addOption(draft, index), [optionsPath])}
              >
                <Plus aria-hidden="true" />
                {t("addOption")}
              </Button>
            </li>
          </ul>
        </div>
      ) : null}

      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 @max-[847px]:grid-cols-1">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={`custom-help-${index}`}>
            {t("help")} <span className="text-app-muted font-normal">{tOptional}</span>
          </Label>
          <Input
            id={`custom-help-${index}`}
            data-testid={`custom-help-${index}`}
            autoComplete="off"
            value={field.help}
            aria-invalid={errors[helpPath] ? true : undefined}
            aria-describedby={describedBy(helpPath, errors[helpPath])}
            onChange={(e) => onChange(updateCustomField(draft, index, { help: e.target.value }), [helpPath])}
          />
        </div>
        <div className="flex min-h-11 items-center gap-3">
          <Switch
            id={`custom-required-${index}`}
            data-testid={`custom-required-${index}`}
            checked={field.required}
            onCheckedChange={(required) => onChange(updateCustomField(draft, index, { required }), [])}
          />
          <Label htmlFor={`custom-required-${index}`}>{t("required")}</Label>
        </div>
      </div>
      <FieldMessage path={helpPath} message={errors[helpPath]} />
      <FieldMessage path={`${path}.id`} message={errors[`${path}.id`]} />
    </li>
  );
}

/**
 * spec: FRM-020, FRM-021, FRM-032, EDI-029. The custom fields of the form, in the order the owner chooses
 * (by dragging the handle or with the arrow keys on it): added by kind, with a label, a help text, a required
 * switch and, for a single choice, its options.
 */
export function CustomFieldsEditor({
  draft,
  errors,
  onChange,
}: {
  draft: EventDraft;
  /** Translated messages by field path. */
  errors: Record<string, string>;
  /** `fixed` lists the field paths this change corrects, so their messages can go. */
  onChange: Change;
}) {
  const t = useTranslations("events.editor.custom");
  const tAll = useTranslations();
  const fields = draft.customFields;
  const ids = fields.map((field) => field.id);
  const full = fields.length >= MAX_CUSTOM_FIELDS;
  const [announced, setAnnounced] = useState("");
  const focusAfter = useRef<string | null>(null);
  // The label of a field just added: it takes the focus once the « Ajouter un champ » menu has closed.
  const focusAfterMenu = useRef<string | null>(null);

  // Right after the DOM changed, so that a key pressed next finds the focus where the move left it.
  useLayoutEffect(() => {
    if (focusAfter.current === null) return;
    document.getElementById(focusAfter.current)?.focus();
    focusAfter.current = null;
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const nameOf = (field: CustomFieldDraft, index: number) => field.label.trim() || t("name", { index: index + 1 });

  function nameOfId(id: string | number): string {
    const index = ids.indexOf(String(id));
    return index < 0 ? "" : nameOf(fields[index]!, index);
  }

  function move(from: number, to: number, announce = true) {
    if (to < 0 || to >= fields.length) return;
    if (announce) setAnnounced(announcement(tAll, nameOf(fields[from]!, from), to + 1, fields.length));
    const handle = `custom-handle-${to}`;
    focusAfter.current = handle;
    onChange(moveCustomField(draft, from, to - from), ["custom_fields"]);
    // Again once the browser has laid the moved rows out: it can drop the focus of a row that moved.
    requestAnimationFrame(() => document.getElementById(handle)?.focus());
  }

  /** The moved field's name and the place of the field it is over. */
  function positionOf(movedId: string | number, overId: string | number): string {
    return announcement(tAll, nameOfId(movedId), ids.indexOf(String(overId)) + 1, fields.length);
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
    move(ids.indexOf(String(active.id)), ids.indexOf(String(over.id)), false);
  }

  function add(kind: CustomFieldKind) {
    onChange(addCustomField(draft, kind), ["custom_fields"]);
    focusAfterMenu.current = `custom-label-${fields.length}`;
  }

  /** The menu takes the focus back while it fades out; the new field's label gets it once the menu is gone. */
  function onMenuCloseAutoFocus(event: Event) {
    const label = focusAfterMenu.current;
    if (label === null) return;
    event.preventDefault();
    focusAfterMenu.current = null;
    document.getElementById(label)?.focus();
  }

  return (
    <div className="flex flex-col gap-4">
      {fields.length === 0 ? <p className="text-app-muted text-sm">{t("empty")}</p> : null}
      <FieldMessage path="custom_fields" message={errors.custom_fields} />
      <p className="sr-only" aria-live="polite" data-testid="custom-live">
        {announced}
      </p>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
        accessibility={{ announcements, screenReaderInstructions: { draggable: t("hint") } }}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {fields.map((field, index) => (
              <CustomFieldRow
                key={field.id}
                index={index}
                draft={draft}
                field={field}
                name={nameOf(field, index)}
                errors={errors}
                t={t}
                tOptional={tAll("events.editor.optional")}
                onChange={onChange}
                onMove={(from, by) => move(from, from + by)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="secondary" data-testid="custom-add" disabled={full} className="self-start">
            <Plus aria-hidden="true" />
            {t("add")}
            <ChevronDown aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        {/* A new field takes the focus (see `onMenuCloseAutoFocus`); closing without choosing gives it back to the button. */}
        <DropdownMenuContent align="start" onCloseAutoFocus={onMenuCloseAutoFocus}>
          {CUSTOM_FIELD_KINDS.map((kind) => (
            <DropdownMenuItem key={kind} data-testid={`custom-add-${kind}`} onSelect={() => add(kind)}>
              {t(`kinds.${kind}`)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <p className="text-app-muted text-[13px] leading-[1.4]">{t("addHint")}</p>
      {full ? <p className="text-app-muted text-sm">{t("max")}</p> : null}
    </div>
  );
}
