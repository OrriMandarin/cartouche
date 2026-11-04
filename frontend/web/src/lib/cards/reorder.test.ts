import { describe, expect, test } from "vitest";
import { announcement, moveItem } from "./reorder";

describe("reorder", () => {
  test("EDI-029 moveItem moves an item without touching the others", () => {
    const list = ["a", "b", "c", "d"];
    expect(moveItem(list, 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(list, 3, 1)).toEqual(["a", "d", "b", "c"]);
    expect(list).toEqual(["a", "b", "c", "d"]);
  });

  test("EDI-029 moveItem keeps the list when the move leaves the list or stays in place", () => {
    const list = ["a", "b"];
    expect(moveItem(list, 0, -1)).toBe(list);
    expect(moveItem(list, 1, 2)).toBe(list);
    expect(moveItem(list, 1, 1)).toBe(list);
  });

  test("EDI-029 announcement names the link and its place", () => {
    const t = (key: string, values?: Record<string, string | number>) => `${key}|${values?.name}|${values?.position}|${values?.total}`;
    expect(announcement(t, "LinkedIn", 2, 5)).toBe("editor.links.position|LinkedIn|2|5");
  });
});
