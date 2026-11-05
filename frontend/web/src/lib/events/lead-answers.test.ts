import { describe, expect, test } from "vitest";
import { displayAnswer, displayBirthDate } from "./lead-answers";
import type { AnswerSnapshot } from "./types";

const snapshot = (kind: AnswerSnapshot["kind"], value: unknown): AnswerSnapshot => ({
  field_id: "0198d000-0000-7000-8000-0000000000aa",
  kind,
  label: "Champ",
  value,
});

describe("displayAnswer", () => {
  test("LEA-019 answers read Oui/Non, French dates and numbers, empty", () => {
    expect(displayAnswer(snapshot("checkbox", true))).toEqual({ kind: "yes" });
    expect(displayAnswer(snapshot("checkbox", false))).toEqual({ kind: "no" });
    expect(displayAnswer(snapshot("date", "2027-09-18"))).toEqual({ kind: "text", text: "18/09/2027" });
    expect(displayAnswer(snapshot("number", 12.5))).toEqual({ kind: "text", text: "12,5" });
    expect(displayAnswer(snapshot("number", 3))).toEqual({ kind: "text", text: "3" });
    expect(displayAnswer(snapshot("text", null))).toEqual({ kind: "empty" });
    expect(displayAnswer(snapshot("checkbox", null))).toEqual({ kind: "empty" });
    expect(displayAnswer(snapshot("date", null))).toEqual({ kind: "empty" });
  });

  test("LEA-019 texts are shown as recorded, accents and emoji intact", () => {
    expect(displayAnswer(snapshot("text", "Zoé Lefèvre ✨"))).toEqual({ kind: "text", text: "Zoé Lefèvre ✨" });
    expect(displayAnswer(snapshot("single_choice", "Végétarien"))).toEqual({ kind: "text", text: "Végétarien" });
    expect(displayAnswer(snapshot("long_text", "Ligne 1\nLigne 2"))).toEqual({
      kind: "text",
      text: "Ligne 1\nLigne 2",
    });
  });

  test("LEA-019 a blank text reads as empty", () => {
    expect(displayAnswer(snapshot("text", ""))).toEqual({ kind: "empty" });
    expect(displayAnswer(snapshot("long_text", "   "))).toEqual({ kind: "empty" });
  });

  test("LEA-033 a datetime answer reads 20/03/2027 à 14:30", () => {
    expect(displayAnswer(snapshot("datetime", "2027-03-20T14:30"))).toEqual({
      kind: "text",
      text: "20/03/2027 à 14:30",
    });
    expect(displayAnswer(snapshot("datetime", "2027-01-01T00:05"))).toEqual({
      kind: "text",
      text: "01/01/2027 à 00:05",
    });
    expect(displayAnswer(snapshot("datetime", null))).toEqual({ kind: "empty" });
    expect(displayAnswer(snapshot("datetime", "bientôt"))).toEqual({ kind: "text", text: "bientôt" });
  });

  test("LEA-019 a date is not shifted by the viewer's time zone", () => {
    expect(displayAnswer(snapshot("date", "2027-01-01"))).toEqual({ kind: "text", text: "01/01/2027" });
    expect(displayAnswer(snapshot("date", "2027-12-31"))).toEqual({ kind: "text", text: "31/12/2027" });
  });
});

describe("displayBirthDate", () => {
  test("LEA-019 the date of birth is a French date", () => {
    expect(displayBirthDate("1990-02-05")).toBe("05/02/1990");
  });
});
