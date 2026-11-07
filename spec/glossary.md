# Glossary

Domain concepts, as the spec uses them.

| Concept | Definition |
|---|---|
| **User** | An account holder. Identified by the `sub` of the JWT from their identity provider (with Clerk, this is the Clerk user ID, `user_…`), and recorded in the `users` table on first sign-in. A user has a **status**: `pending`, `approved`, `rejected` or `suspended`. |
| **Administrator** | A user whose ID is listed in the instance configuration. Administrators approve sign-ups and can view everything. |
| **Card** | A digital business card. Belongs to a user. Has a slug (public link), a template, theme settings, media, content and an enabled/disabled state. |
| **Template** | The complete layout of a public card (structure, arrangement, animations). It is code in the repository. |
| **Theme** | The visual settings applied inside a template (colors, font, styles). They are data. |
| **Event** | A lead collection period attached to a card: title, description, start, optional end, form fields, optional access code, per-device submission limit. |
| **Lead** | A submission of an event's form by a prospect. |

## Additional terms

| Term | Definition |
|---|---|
| **Prospect** | An anonymous visitor of a card's public page, most often on a phone. |
| **Owner** | The owner of a card: the user who manages it. |
| **Slug** | The variable part of a card's public link (`/c/<slug>`). |
| **Current slug** | A card's present slug, the one in its public link. |
| **Former slug** | A slug a card used before its current slug; it redirects to the current slug (see LNK-003). |
| **Reserved slug** | A slug of a deleted card: it stays with its former owner, who can attach it to a new card (see LNK-013 and LNK-014). |
| **Blocked slug** | A slug of a deleted account, kept only as a hash so that nobody can ever take it again (see LNK-015 and LNK-031). |
| **Neutral page** | The "Cette carte n’est pas disponible" ("This card is not available") page, served with HTTP status 404 at the link of a card that is not served and of a slug never assigned (see LNK-023, LNK-026, LNK-027 and LNK-034). |
| **Media** | A card's header background (image or video) or profile photo, kept in the media storage. |
| **Event state** | "À venir" ("upcoming"), "en cours" ("in progress") or "passé" ("past"), computed by the server (see EVT-020). |
| **Submission window** | The period during which an event's form is open: from its start until 15 minutes after its end (see EVT-008 and EVT-026). |
| **Ready-made theme** | One of the eight themes a card starts from (`craie`, `ivoire`, `terracotta`, `sauge`, `bonbon`, `lagon`, `encre`, `minuit`), adjusted by the owner's own settings (see TPL-009 and TPL-010). |
| **Contrast checks** | The four contrast ratios a theme must reach to be saved: text, muted text, text on the accent, accent (see TPL-018 and TPL-023). |
| **Source** | What the server keeps of a media so that it can be re-framed: for an image, its whole image, from which its displayed files are cut (see MED-025); for a video, its edit copy (see MED-037). |
| **Original** | The file uploaded for a header video, kept in private storage and never served: the input of every re-framing of the video (see MED-036). |
| **Served file** | The file of a header video that the public page plays, transcoded by the server along the video's crop and loop (see MED-034). |
| **Edit copy** | A smaller copy of a header video, whole frame and whole length, that the dashboard plays and draws frames from to re-frame the video; it is the video's source (see MED-037). |
| **Crop** | The rectangle of the source shown on the card, in proportions of the source: 4:3 for the header, square for the profile photo (see MED-026). |
| **Framing** | A media's crop and, for a video, its loop and its poster time (see MED-028 and MED-030). |
| **Device identifier** | A random identifier kept by the prospect's browser, used for the per-device submission limit (see EVT-028). |
| **Honeypot field** | A form field invisible to a human; a bot that fills it in is ignored (see ABU-002). |
| **Font pair** | A heading font and a body font, chosen together for a theme (see TPL-011). |
| **Whole-card view** | The list of the leads of all the events of a card, "toute la carte" in the interface (see LEA-013). |
| **Export** | A file (CSV, XLSX or JSON) of the leads of an event or of a whole card, downloaded from the dashboard (see LEA-006 and LEA-021). |
| **Audit log** | The append-only record of administrator actions and of their views of leads (see ADM-005 and ADM-008). |
