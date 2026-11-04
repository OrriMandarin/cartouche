import { describe, expect, test } from "vitest";
import { leadView } from "./lead-view.fixture";
import { filterLeads, fold, leadMatches } from "./lead-search";

const eloise = leadView({
  id: "lead-eloise",
  answers: {
    first_name: "Éloïse",
    last_name: "D’Aubigné-Müller",
    email: "eloise@example.test",
    phone: "+33612345678",
    city: "Besançon",
    street: "12 rue des Lilas",
  },
  custom: [
    { field_id: "f1", kind: "text", label: "Entreprise", value: "Brasserie de l’Épée" },
    { field_id: "f2", kind: "date", label: "Mariage", value: "2027-09-18" },
    { field_id: "f3", kind: "number", label: "Invités", value: 120 },
    { field_id: "f4", kind: "single_choice", label: "Menu", value: "Végétarien" },
    { field_id: "f5", kind: "long_text", label: "Message", value: "Nous cherchons un traiteur" },
    { field_id: "f6", kind: "checkbox", label: "Newsletter", value: true },
  ],
});
const zoe = leadView({
  id: "lead-zoe",
  answers: { first_name: "Zoé", last_name: "Lefèvre ✨", email: "zoe@example.test" },
});
const nameless = leadView({ id: "lead-none", answers: { phone: "+33799999999" } });

describe("fold", () => {
  test("LEA-015 folds case and accents and trims", () => {
    expect(fold("  ÉLOÏSE Müller ")).toBe("eloise muller");
  });
});

describe("filterLeads", () => {
  test("LEA-015 search ignores case and accents, every word must match", () => {
    const all = [eloise, zoe];
    expect(filterLeads(all, "eloise aubigne")).toEqual([eloise]);
    expect(filterLeads(all, "ÉLOÏSE")).toEqual([eloise]);
    expect(filterLeads(all, "eloise zoe")).toEqual([]);
    expect(filterLeads(all, "  lefevre   ZOE ")).toEqual([zoe]);
  });

  test("LEA-015 search covers email, city and text custom answers but not dates or numbers", () => {
    const all = [eloise, zoe];
    expect(filterLeads(all, "example.test")).toEqual([eloise, zoe]);
    expect(filterLeads(all, "zoe@example")).toEqual([zoe]);
    expect(filterLeads(all, "besancon")).toEqual([eloise]);
    expect(filterLeads(all, "brasserie epee")).toEqual([eloise]);
    expect(filterLeads(all, "vegetarien")).toEqual([eloise]);
    expect(filterLeads(all, "traiteur")).toEqual([eloise]);
    expect(filterLeads(all, "2027-09-18")).toEqual([]);
    expect(filterLeads(all, "120")).toEqual([]);
    expect(filterLeads(all, "newsletter")).toEqual([]);
    expect(filterLeads(all, "lilas")).toEqual([]);
  });

  test("LEA-033 the search ignores datetime answers", () => {
    const withAppointment = leadView({
      id: "lead-rdv",
      answers: { first_name: "Inès" },
      custom: [{ field_id: "f7", kind: "datetime", label: "Rendez-vous", value: "2027-03-20T14:30" }],
    });
    expect(filterLeads([withAppointment], "2027-03-20")).toEqual([]);
    expect(filterLeads([withAppointment], "14:30")).toEqual([]);
    expect(filterLeads([withAppointment], "ines")).toEqual([withAppointment]);
  });

  test("LEA-016 a phone-like word matches the phone digits without leading zeros", () => {
    const all = [eloise, zoe, nameless];
    expect(filterLeads(all, "0612")).toEqual([eloise]);
    expect(filterLeads(all, "06.12")).toEqual([eloise]);
    expect(filterLeads(all, "06 12 34")).toEqual([eloise]);
    expect(filterLeads(all, "+33 6")).toEqual([eloise]);
    expect(filterLeads(all, "(0)6-12")).toEqual([eloise]);
    expect(filterLeads(all, "0699")).toEqual([]);
    expect(filterLeads(all, "0799")).toEqual([nameless]);
  });

  test("LEA-016 a word made only of zeros matches no phone", () => {
    expect(filterLeads([eloise, zoe], "0")).toEqual([]);
    expect(filterLeads([eloise, zoe], "000")).toEqual([]);
    expect(leadMatches(leadView({ answers: { phone: "+33600000000" } }), "0")).toBe(false);
  });

  test("LEA-016 a word without a digit never matches by phone", () => {
    expect(filterLeads([zoe, nameless], "+")).toEqual([]);
    expect(filterLeads([zoe, nameless], "-")).toEqual([]);
  });

  test("LEA-015 an empty search keeps the whole list in order", () => {
    const all = [zoe, eloise, nameless];
    expect(filterLeads(all, "")).toEqual(all);
    expect(filterLeads(all, "   ")).toEqual(all);
  });
});
