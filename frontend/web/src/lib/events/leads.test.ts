import { describe, expect, test } from "vitest";
import { leadView } from "./lead-view.fixture";
import { leadHeading } from "./leads";

const answers = (patch: Partial<ReturnType<typeof leadView>["answers"]>) => leadView({ answers: patch });

describe("leadHeading", () => {
  test("EDI-020 LEA-017 joins first and last name, accents and emoji intact", () => {
    expect(leadHeading(leadView())).toEqual({ kind: "name", text: "Éloïse D’Aubigné-Müller" });
    expect(leadHeading(answers({ first_name: "Zoé", last_name: "Lefèvre ✨" }))).toEqual({
      kind: "name",
      text: "Zoé Lefèvre ✨",
    });
  });

  test("EDI-020 LEA-017 a single name part is shown alone", () => {
    expect(leadHeading(answers({ first_name: "Zoé", email: "zoe@example.test" }))).toEqual({
      kind: "name",
      text: "Zoé",
    });
    expect(leadHeading(answers({ last_name: "Lefèvre", email: "zoe@example.test" }))).toEqual({
      kind: "name",
      text: "Lefèvre",
    });
  });

  test("LEA-017 a lead without a name is titled by its email", () => {
    expect(leadHeading(answers({ email: "zoe@example.test" }))).toEqual({ kind: "email", text: "zoe@example.test" });
    expect(leadHeading(answers({ first_name: "  ", last_name: null, email: "zoe@example.test" }))).toEqual({
      kind: "email",
      text: "zoe@example.test",
    });
  });

  test("LEA-017 a lead with neither name nor email is unnamed", () => {
    expect(leadHeading(answers({ phone: "+33612345678" }))).toEqual({ kind: "unnamed" });
    expect(leadHeading(answers({ email: "   " }))).toEqual({ kind: "unnamed" });
  });
});
