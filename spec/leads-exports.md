# Leads and exports

> Status: specified, not implemented (plan 4); the list of an event's leads, with spam marking and deletion, exists since plan 3 (EDI-020); LEA-033 to LEA-035: plan 6 (phase B)

## Viewing

- **LEA-001** — The dashboard lists the leads by event, and offers a "toute la carte" ("whole card") view.
- **LEA-002** — The owner can search among their leads.
- **LEA-003** — The owner can open the detail view of a lead.
- **LEA-004** — From the list or the detail view, the owner can mark a lead as spam and delete it (see ABU-003 and ABU-004).
- **LEA-005** — Deleting a lead also serves to answer a GDPR erasure request.
- **LEA-034** — After a lead is marked or unmarked as spam (LEA-004), a short message confirms it with an "Annuler" ("Undo") button, which puts the lead back in its previous state.

## Exports

- **LEA-006** — The owner can export their leads by event or for the whole card, as CSV, XLSX or JSON.
- **LEA-007** — The CSV export is UTF-8 with a BOM, so that accented characters display correctly in Excel, and it is compatible with Notion's import.
- **LEA-008** — The XLSX export is a native XLSX file.
- **LEA-009** — The JSON export is structured and keeps the field types.
- **LEA-010** — An export contains one row per lead.
- **LEA-011** — The columns of an export are, in order: the standard fields, the custom fields (including those deleted since, see FRM-023), then the metadata (event, submission date, consent, consent text, spam).
- **LEA-012** — Leads marked as spam are excluded from exports by default, with an option to include them.
- **LEA-033** — A `datetime` answer (FRM-043) is shown and exported as the prospect entered it, never converted to another time zone: in the detail view as a French date and time ("06/02/2027 à 14:30"), in the CSV export as `YYYY-MM-DD HH:MM`, in the XLSX export as a date cell with a time (`yyyy-mm-dd hh:mm`) and in the JSON export as the string `YYYY-MM-DDTHH:MM`. The search (LEA-002) does not look into it.
- **LEA-035** — The export dialog gives the number of spam leads of its scope in its option ("Inclure les contacts marqués comme spam ({n})", "Include the contacts marked as spam") and, on its button, the exact number of leads the file will hold ("Exporter {n} contacts", "Export {n} contacts"), see LEA-012.
