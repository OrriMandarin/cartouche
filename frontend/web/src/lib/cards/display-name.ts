import type { components } from "@cartouche/api-client";

/** spec: EDI-012. The name a card is listed under, or `null` when it has neither first nor last name. */
export function cardDisplayName(content: Pick<components["schemas"]["ContentView"], "first_name" | "last_name">): string | null {
  const name = [content.first_name, content.last_name].filter(Boolean).join(" ");
  return name === "" ? null : name;
}
