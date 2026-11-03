# Cartouche spec

`spec/` describes **how the product must behave**. It is the project's living reference: when the code and the spec disagree, the spec is authoritative, unless the spec is explicitly changed.

It comes from the initial design document (`docs/superpowers/specs/2026-11-02-cartouche-design.md`, sections 4 to 6 and 7.5, in French), which is no longer updated. The decisions marked "choix Claude" ("Claude's choice") in the design have become ordinary rules here.

## Files and prefixes

One file per topic, so that two simultaneous changes almost always touch different files. Each file has its own ID prefix: numbering is independent from one file to the next.

The spec linter (`node scripts/spec-lint.mjs`) reads this table: a topic file missing from the table, or a prefix used twice, is an error.

| File | Prefix | Topic |
|---|---|---|
| `card-links.md` | LNK | Public link, slug, disabling, deletion |
| `public-page.md` | PUB | Public page, vCard, link previews |
| `templates-themes.md` | TPL | Template contract, themes, fonts |
| `media.md` | MED | Images, videos, limits, processing |
| `events.md` | EVT | Period, overlap, access code, per-device limit |
| `event-form.md` | FRM | Lead form, fields, consent |
| `anti-abuse.md` | ABU | Per-IP limits, honeypot field, spam |
| `leads-exports.md` | LEA | Viewing, deleting and exporting leads |
| `account-auth.md` | ACC | Account, authentication, data isolation |
| `admin-support.md` | ADM | Sign-up approval, support, audit |
| `dashboard-editor.md` | EDI | Dashboard, editor, live preview |
| `landing.md` | LND | Landing page, terms of service and privacy pages |

The glossary of concepts is in `glossary.md` (it contains no numbered rules).

## Rule format

A rule is a list line of the form:

```
- **XXX-NNN** — Rule text.
```

- `XXX` is the file's prefix (3 capital letters), `NNN` a 3-digit number, followed by an em dash surrounded by spaces.
- A rule describes **a single verifiable behavior**. Rules are grouped under `##` headings.
- An ID is **stable**: it is never renumbered and never reused, even if the rule is removed.
- A rule that concerns another one **cites it by its ID** (for example "see EVT-004") instead of copying it, so that there are never two versions of the same text. Every citation must point to an existing rule.
- Each topic file opens, under its title, with a `> Status: …` line that says whether the topic is already implemented or which plan it belongs to.
- The spec is written in English, in UTF-8. When a rule quotes a label of the user interface (which is in French), it keeps the French label verbatim and gives its English meaning in parentheses.

## Changing the spec

1. **Every feature or bug fix starts with a spec update.**
2. Then check that **no existing rule is contradicted** (reread the neighboring files and follow the citations).
3. If there is a contradiction or a behavior change, **flag it explicitly to the project maintainer before coding**.
4. A new topic becomes a new file, with a new prefix declared in the table above.
5. Run `node scripts/spec-lint.mjs` (or `make spec-lint`): duplicates, inconsistent prefixes and citations of unknown rules make the check fail.

## Citing a rule in tests

Every test that checks a rule cites its ID, so that the tests of a rule can be found and, conversely, the rules of a test.

- **TypeScript** (`*.test.ts`, `*.spec.ts`, `*.test.tsx`): the ID appears in the test name, for example `test('EVT-004 rejects a fourth concurrent event', …)`.
- **Rust** (files under `tests/` and under `src/` for inline tests): a `// spec: EVT-004` comment right before the test.
- The linter treats any occurrence of `XXX-NNN` (3 capital letters, a hyphen, 3 digits) in these files as a citation. A citation of a rule that does not exist is an error.
- `node scripts/spec-lint.mjs --coverage` also lists the rules that no test cites yet.
