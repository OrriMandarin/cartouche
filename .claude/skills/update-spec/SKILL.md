---
name: update-spec
description: Use when a feature request, change of behavior or bug fix needs a new or modified rule in spec/, before writing any code, or when you need to add a spec file, number a rule, or check that a change does not contradict existing rules.
---

# Change the spec without contradictions

The `spec/` is authoritative. **Every feature or bug fix starts here**, before the code. Full format and conventions: `spec/README.md`.

## 1. Find the right file

The table in `spec/README.md` maps a file, a 3-letter prefix and a topic (`account-auth.md` → `ACC`, `events.md` → `EVT`, …).

```bash
sed -n '/^| File/,/^$/p' spec/README.md        # the table
grep -n "^## " spec/<file>.md                     # the sections of the file
```

A topic that does not exist yet = a **new file** + a line in the table with a free prefix (never used before) + a `> Status: …` line under the title.

## 2. Take the next free number

```bash
grep -o 'ACC-[0-9]\{3\}' spec/account-auth.md | sort -u | tail -3     # replace ACC with the prefix
```

Take the next one. **Never renumber or reuse** an identifier, even a vanished one. One rule = a single verifiable behavior, in the form:

```
- **ACC-019** — Text of the rule.
```

(em dash surrounded by spaces; written in English, UTF-8). A rule that concerns another one cites it by identifier ("see ACC-004") instead of copying it.

## 3. Look for related rules and contradictions

Before writing, reread the neighboring rules:

```bash
grep -rn -i "<keyword>" spec/                 # vocabulary words (status, limit, link, device…)
grep -rn "ACC-004" spec/ apps e2e --exclude-dir=node_modules --exclude-dir=target --exclude-dir=.next    # who cites a rule
grep -n -i "<term>" spec/glossary.md          # the glossary fixes the terms
```

Follow every identifier cited by the rule being touched, and every rule that cites it.

## 4. Flag before coding

If the new rule **contradicts** an existing rule, or **changes a behavior** already specified or implemented: stop and tell the project maintainer (rule concerned, old behavior, new one, tests to change). Do not code until it is decided. A modified rule keeps its identifier; the tests that cite it must be reread.

## 5. Verify

```bash
node scripts/spec-lint.mjs              # duplicates, prefixes, citations of a nonexistent rule
node scripts/spec-lint.mjs --coverage   # also: rules that no test cites yet
```

Then plan the tests: every new or modified rule has at least one test that cites it (`// spec: XXX-NNN` in Rust, `XXX-NNN` in the test name in TypeScript). Update the file's `> Status` line if the implemented scope changes.
