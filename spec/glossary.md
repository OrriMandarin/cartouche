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
| **Neutral page** | The "Cette carte n'est plus active" ("This card is no longer active") page, shown at the link of a card that is not served (see LNK-026 and LNK-027). |
| **Media** | A card's header background (image or video) or profile photo, kept in the media storage. |
| **Font pair** | A heading font and a body font, chosen together for a theme (see TPL-011). |
