"use client";

import { AccountGate } from "@/components/account/AccountGate";
import { NewCardForm } from "@/components/cards/NewCardForm";

/** spec: EDI-013. Creation of a card: name, then slug. */
export default function NewCardPage() {
  return (
    <AccountGate>
      <NewCardForm />
    </AccountGate>
  );
}
