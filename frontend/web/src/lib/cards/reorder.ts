import type { Translate } from "./section-summary";

/** The list with the item at `from` moved to `to`; the same list when either place is outside it or they are equal. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const inside = (index: number) => index >= 0 && index < list.length;
  if (from === to || !inside(from) || !inside(to)) return list as T[];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

/** What a screen reader hears once an item has moved (`position` counts from 1). */
export function announcement(t: Translate, name: string, position: number, total: number): string {
  return t("editor.links.position", { name, position, total });
}
