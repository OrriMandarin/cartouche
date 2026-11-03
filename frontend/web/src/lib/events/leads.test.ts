import { describe, expect, test } from "vitest";
import { leadView } from "./lead-view.fixture";
import { leadDisplayName } from "./leads";

const answers = (patch: Partial<ReturnType<typeof leadView>["answers"]>) => leadView({ answers: patch });

describe("leadDisplayName", () => {
  test("EDI-020 joins first and last name, accents and emoji intact", () => {
    expect(leadDisplayName(leadView())).toBe("Éloïse D’Aubigné-Müller");
    expect(leadDisplayName(answers({ first_name: "Zoé", last_name: "Lefèvre ✨" }))).toBe("Zoé Lefèvre ✨");
  });

  test("EDI-020 a single name part is shown alone", () => {
    expect(leadDisplayName(answers({ first_name: "Zoé", email: "zoe@example.test" }))).toBe("Zoé");
    expect(leadDisplayName(answers({ last_name: "Lefèvre", email: "zoe@example.test" }))).toBe("Lefèvre");
  });

  test("EDI-020 a lead without a name shows its email", () => {
    expect(leadDisplayName(answers({ email: "zoe@example.test" }))).toBe("zoe@example.test");
    expect(leadDisplayName(answers({ first_name: "  ", last_name: null, email: "zoe@example.test" }))).toBe(
      "zoe@example.test",
    );
  });

  test("EDI-020 a lead with neither name nor email has no display name", () => {
    expect(leadDisplayName(answers({ phone: "+33612345678" }))).toBeNull();
  });
});
