import { createTranslator } from "next-intl";
import { describe, expect, test } from "vitest";
import messages from "../../../messages/fr.json";
import { countLeads, exportCount } from "./export-count";
import { leadView } from "./lead-view.fixture";

const t = createTranslator({ locale: "fr", messages, namespace: "leads" });

describe("export count", () => {
  test("LEA-035 counts the contacts and the spam among them", () => {
    const leads = [leadView({ id: "a" }), leadView({ id: "b", spam: true }), leadView({ id: "c" })];
    expect(countLeads(leads)).toEqual({ total: 3, spam: 1 });
    expect(countLeads([])).toEqual({ total: 0, spam: 0 });
  });

  test("LEA-035 the export holds every contact but the spam ones, unless they are included", () => {
    expect(exportCount({ total: 4, spam: 1 }, false)).toBe(3);
    expect(exportCount({ total: 4, spam: 1 }, true)).toBe(4);
    expect(exportCount({ total: 2, spam: 2 }, false)).toBe(0);
  });

  test("LEA-035 the summary reads correctly for none, one and many contacts and spam", () => {
    const summary = (total: number, spam: number) => t("summary", { total, spam });
    expect(summary(0, 0)).toBe("Aucun contact");
    expect(summary(1, 0)).toBe("1 contact");
    expect(summary(107, 0)).toBe("107 contacts");
    expect(summary(1, 1)).toBe("1 contact, dont 1 marqué comme spam");
    expect(summary(107, 3)).toBe("107 contacts, dont 3 marqués comme spam");
  });

  test("LEA-035 the export button reads correctly for none, one and many contacts", () => {
    // French counts 0 as singular.
    expect(t("export.download", { count: 0 })).toBe("Exporter 0 contact");
    expect(t("export.download", { count: 1 })).toBe("Exporter 1 contact");
    expect(t("export.download", { count: 37 })).toBe("Exporter 37 contacts");
  });

  test("LEA-035 the spam checkbox reads correctly for one and many spam contacts", () => {
    expect(t("export.includeSpam", { count: 1 })).toBe("Inclure les contacts marqués comme spam (1)");
    expect(t("export.includeSpam", { count: 3 })).toBe("Inclure les contacts marqués comme spam (3)");
  });
});
