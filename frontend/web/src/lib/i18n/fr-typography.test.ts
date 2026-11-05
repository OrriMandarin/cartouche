import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const source = readFileSync(path.join(__dirname, "../../../messages/fr.json"), "utf8");

function collectValues(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string") out.push(node);
  else if (node && typeof node === "object") Object.values(node).forEach((v) => collectValues(v, out));
  return out;
}

const values = collectValues(JSON.parse(source));

describe("French typography", () => {
  test("EDI-011 the French texts use typographic apostrophes and non-breaking spaces", () => {
    // Raw source: non-breaking spaces stay visible as escapes.
    expect(source).not.toMatch(/[  ]/);
    for (const value of values) {
      expect(value, value).not.toContain("'");
      expect(value, value).not.toMatch(/ [:;?!]/);
      expect(value, value).not.toMatch(/«(?! )/);
      expect(value, value).not.toMatch(/(?<! )»/);
    }
  });
});
