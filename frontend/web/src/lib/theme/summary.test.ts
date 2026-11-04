import { describe, expect, test } from "vitest";
import messages from "../../../messages/fr.json";
import { themeSummary } from "./summary";

const t = (key: string, values?: Record<string, string | number>) => {
  const message = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], messages);
  return String(message).replace(/\{(\w+)\}/g, (_, name: string) => String(values?.[name]));
};

describe("themeSummary", () => {
  test("EDI-030 the summary is the theme's name, then personnalisé once a setting changed", () => {
    expect(themeSummary({ preset: "terracotta" }, t)).toBe("Terracotta");
    expect(themeSummary({ preset: "terracotta", accent: "#b3441e" }, t)).toBe("Terracotta");
    expect(themeSummary({ preset: "terracotta", text: "#111111" }, t)).toBe("Terracotta, personnalisé");
  });
});
