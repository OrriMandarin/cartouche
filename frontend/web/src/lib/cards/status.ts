import type { components } from "@cartouche/api-client";

export type CardStatus = components["schemas"]["CardStatus"];

const LABEL_KEYS = {
  active: "cards.status.active",
  disabled: "cards.status.disabled",
  disabled_by_support: "cards.status.disabledBySupport",
} as const satisfies Record<CardStatus, string>;

/** Message key of the badge that names a card's status. */
export function cardStatusLabelKey(status: CardStatus): (typeof LABEL_KEYS)[CardStatus] {
  return LABEL_KEYS[status];
}

/**
 * spec: LNK-011. The owner can disable or re-enable a card, except one the support disabled.
 * The server stays the reference and answers 409 card_disabled_by_support otherwise.
 */
export function canToggle(status: CardStatus): boolean {
  return status !== "disabled_by_support";
}

/** spec: EDI-014. A card disabled by the support cannot be duplicated either (409 card_disabled_by_support). */
export function canDuplicate(status: CardStatus): boolean {
  return status !== "disabled_by_support";
}

/** spec: LNK-036. A card disabled by the support is read-only for its owner (409 card_disabled_by_support). */
export function canEdit(status: CardStatus): boolean {
  return status !== "disabled_by_support";
}

/** The number of cards that are active, for the summary of the card list. */
export function countActive(cards: readonly { status: CardStatus }[]): number {
  return cards.filter((card) => card.status === "active").length;
}
