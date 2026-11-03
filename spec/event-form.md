# Event form

> Status: specified, not implemented (plan 3)

## Prospect journey

- **FRM-001** — A click on the event button opens the form fullscreen, with a back button to the card.
- **FRM-002** — If the event has an access code, a screen asks for the code before the form (see EVT-011, EVT-012 and EVT-013).
- **FRM-003** — The form shows the event's title and description, then the enabled standard fields, then the custom fields.
- **FRM-004** — After submission, a confirmation screen offers to save the owner's vCard, then a return to the card.
- **FRM-005** — The form is accessible: labels, keyboard navigation, suitable mobile keyboard types (`type="email"`, `inputmode="tel"`…).

## Consent

- **FRM-006** — Consent is required: a checkbox accompanies a legal notice text.
- **FRM-007** — A default legal notice text, in French and in the spirit of the GDPR, is provided; it can be replaced per event.
- **FRM-008** — On submission, the server records the consent timestamp and the exact text that was accepted.
- **FRM-009** — The data controller is the card's owner, not the instance operator: the default text is filled in automatically with the card's name or company and email.
- **FRM-010** — The default text states the purpose (commercial follow-up related to the event) and the right of access and deletion.
- **FRM-011** — The default text commits to no specific retention period: there is no automatic deletion in v1, deletion remains manual.

## Validation

- **FRM-012** — The entered email must be valid.
- **FRM-013** — The phone number is validated and normalized to the international E.164 format, with France as the default country.
- **FRM-014** — Entered dates must be valid.
- **FRM-015** — Errors are shown next to each field, and the input is never lost.
- **FRM-016** — Entered strings are normalized to NFC before being stored.

## Standard fields

- **FRM-017** — The standard fields the owner can check are: first name, last name, date of birth, email, phone number and postal address.
- **FRM-018** — The postal address breaks down into street, postal code, city and country.
- **FRM-019** — Each checked standard field can be required or optional.

## Custom fields

- **FRM-020** — The owner can add as many custom fields as they want, and order them. Each field has a label, a type, a required or optional flag, and an optional help text.
- **FRM-021** — The custom field types are: `text`, `long text`, `date`, `number`, `single choice` (with a list of options) and `checkbox`.

## Field evolution

- **FRM-022** — Changing an event's fields while leads already exist never breaks the existing leads: each lead keeps its answers with the field's label and type as they were at submission time.
- **FRM-023** — A deleted field remains visible on old leads and in exports (see LEA-011).
