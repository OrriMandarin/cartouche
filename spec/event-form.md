# Event form

> Status: implemented (plan 3)

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

## Form address and states

- **FRM-024** — An event's form is served at the address `/c/<slug>/e/<event ID>`. A former slug or a slug written in uppercase redirects to the address of the current slug (see LNK-024 and LNK-030); a card that is not served shows the neutral page (see LNK-007 and LNK-027); an unknown or deleted event, or one of another card, shows a "Formulaire introuvable" ("Form not found") page with HTTP status 404; outside the window of EVT-026, a screen says the form is not open, with a return to the card.
- **FRM-025** — The form, its code screen and its confirmation screen are shared by all templates (see TPL-020); their texts address the prospect formally (with "vous").

## Consent text

- **FRM-026** — The default text is, word for word: "En cochant cette case, j'accepte que {responsable} conserve les informations saisies dans ce formulaire afin de me recontacter à des fins commerciales en lien avec l'événement « {événement} ». {responsable} est responsable de ce traitement. Je peux à tout moment demander l'accès à mes données, leur rectification ou leur suppression en écrivant à {email}." ("By checking this box, I agree that {controller} keeps the information entered in this form in order to contact me again for commercial purposes related to the event '{event}'. {controller} is the controller of this processing. I can at any time request access to my data, its correction or its deletion by writing to {email}.") {événement} is the event's title; {email} is the card's email.
- **FRM-027** — In the default text, {responsable} is the card's first and last name (or whichever of the two is filled in, see PUB-018), followed by the company in parentheses when it is filled in: "Alice Durand (Atelier Durand & Fils)". If the card has no email, the last sentence becomes "Je peux à tout moment demander l'accès à mes données, leur rectification ou leur suppression auprès de {responsable}." ("I can at any time request access to my data, its correction or its deletion from {controller}.")
- **FRM-028** — A custom text (FRM-007) is at most 3,000 characters long and is shown as is, without variables; a text that is empty after normalization falls back to the default text.
- **FRM-029** — The event editor shows the default text as it will be presented, and warns the owner when the card has no email.
- **FRM-030** — The server computes the text recorded by FRM-008 itself. If the form definition presented to the prospect (title, description, fields or consent text) changed before submission, the submission is rejected with `409 form_changed`: the form reloads, the answers to the fields that still exist are kept and the consent checkbox is unchecked.

## Field definition

- **FRM-031** — A form has at least one field, a checked standard field or a custom field; otherwise the `standard_fields` field is rejected with the code `no_fields`.
- **FRM-032** — An event has at most 30 custom fields (code `too_many_fields`). Each one has a stable identifier (a UUID created by the editor, unique within the event, code `duplicate_field_id`), a required label of at most 100 characters and a help text of at most 300. A `single choice` field has 2 to 20 options (codes `too_few_options`, `too_many_options`), each required, at most 100 characters long and with no duplicate (code `duplicate_option`); the other types have no options.
- **FRM-033** — If the postal address is required, its four parts are required; the form suggests "France" as the country.

## Answers

- **FRM-034** — Maximum answer lengths: 100 characters for the first name, the last name, the city and the country; 254 for the email; 200 for the street; 20 for the postal code; 500 for a `text` field; 5,000 for a `long text`. Beyond that: code `too_long`. An empty required field: code `required`; a required `checkbox` must be checked.
- **FRM-035** — A date is in the `YYYY-MM-DD` format, exists in the calendar and lies between January 1, 1900 and December 31, 2100; a date of birth is not in the future. Otherwise: code `invalid_date`.
- **FRM-036** — A `number` is a decimal number, entered with a point or a comma (code `invalid_number`); a `single choice` is one of the field's options (code `invalid_choice`).
- **FRM-037** — Unchecked consent is rejected (field `consent`, code `required`).
- **FRM-038** — A lead records: the submission date, the answers to the standard fields, one answer per custom field existing at submission time (empty if not filled in) with its identifier, its label and its type (see FRM-022), the consent timestamp and its text (see FRM-008), and the device identifier. The prospect's IP address is not recorded.

## Prospect input

- **FRM-039** — Fields use the browser's input types and autocompletion: first name `given-name`, last name `family-name`, date of birth `type="date"` and `bday`, email `type="email"` and `email`, phone `type="tel"`, `inputmode="tel"` and `tel`, address `street-address`, `postal-code`, `address-level2` and `country-name`, number `inputmode="decimal"`, date `type="date"`.
- **FRM-040** — The input is kept in the browser's session storage until the submission succeeds: a page reload, a network error or a server rejection does not lose it. A network error shows a message and lets the prospect resend.
- **FRM-041** — If the code changed between entering the code and submitting (EVT-013), the submission is rejected with `403 invalid_access_code`: the code screen reappears with a message, and the answers are kept for the next submission.
- **FRM-042** — Each server rejection on submission has its own message: form closed (`event_closed`), device limit reached (`device_limit_reached`), too many submissions from this network (`rate_limited`), card no longer active (`card_inactive`).
