import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { lint } from './spec-lint.mjs';

const SCRIPT = fileURLToPath(new URL('./spec-lint.mjs', import.meta.url));

const README = `# Spec

| File | Prefix | Topic |
|---|---|---|
| \`events.md\` | EVT | Events |
| \`event-form.md\` | FRM | Form |
`;

/** Builds a temp tree: { 'spec/README.md': '...', 'code/a.test.ts': '...' } and returns its root. */
function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-lint-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  }
  return root;
}

function run(root, extra = {}) {
  return lint({
    specDir: path.join(root, 'spec'),
    codeDirs: [path.join(root, 'code')],
    coverage: false,
    ...extra,
  });
}

const validSpec = {
  'spec/README.md': README,
  'spec/events.md': '# Events\n\n## Period\n\n- **EVT-001** — An event has a start.\n- **EVT-002** — It ends (see EVT-001).\n',
  'spec/event-form.md': '# Form\n\n- **FRM-001** — Consent is required.\n',
};

test('rejects a duplicate rule id', () => {
  const root = fixture({
    ...validSpec,
    'spec/events.md': '- **EVT-001** — One.\n- **EVT-001** — Two.\n',
  });
  const { errors } = run(root);
  assert.ok(errors.some((e) => e.includes('EVT-001') && /duplicate/i.test(e)), errors.join('\n'));
});

test('rejects an id whose prefix does not match its file', () => {
  const root = fixture({
    ...validSpec,
    'spec/events.md': '- **FRM-001** — Wrong prefix.\n',
    'spec/event-form.md': '- **FRM-002** — Ok.\n',
  });
  const { errors } = run(root);
  assert.ok(errors.some((e) => e.includes('FRM-001') && /prefix/i.test(e)), errors.join('\n'));
});

test('rejects a prefix missing from the README table', () => {
  const root = fixture({
    ...validSpec,
    'spec/anti-abuse.md': '- **ABU-001** — Honeypot field.\n',
  });
  const { errors } = run(root);
  assert.ok(errors.some((e) => e.includes('anti-abuse.md') && /README/.test(e)), errors.join('\n'));
});

test('rejects a README table entry whose file does not exist', () => {
  const root = fixture(validSpec);
  fs.rmSync(path.join(root, 'spec/event-form.md'));
  const { errors } = run(root);
  assert.ok(errors.some((e) => e.includes('event-form.md') && /exist/i.test(e)), errors.join('\n'));
});

test('rejects two files sharing the same prefix in the README table', () => {
  const root = fixture({
    ...validSpec,
    'spec/README.md': README.replace('| FRM |', '| EVT |'),
  });
  const { errors } = run(root);
  assert.ok(errors.some((e) => e.includes('EVT') && /twice|duplicate/i.test(e)), errors.join('\n'));
});

test('rejects a malformed rule line', () => {
  const root = fixture({
    ...validSpec,
    'spec/events.md': '- **EVT-1** — trop court.\n',
  });
  const { errors } = run(root);
  assert.ok(errors.some((e) => e.includes('EVT-1') && /malformed/i.test(e)), errors.join('\n'));
});

test('ignores rule-like lines inside fenced code blocks', () => {
  const root = fixture({
    ...validSpec,
    'spec/README.md': `${README}\n\`\`\`\n- **XXX-NNN** — example (see ZZZ-123)\n\`\`\`\n`,
  });
  assert.deepEqual(run(root).errors, []);
});

test('rejects a spec cross-reference to an unknown rule', () => {
  const root = fixture({
    ...validSpec,
    'spec/events.md': '- **EVT-001** — One (see FRM-099).\n',
  });
  const { errors } = run(root);
  assert.ok(errors.some((e) => e.includes('FRM-099')), errors.join('\n'));
});

test('rejects a test citing an unknown rule', () => {
  const root = fixture({
    ...validSpec,
    'code/web/cards.spec.ts': "test('ACC-999 does a thing', () => {});\n",
    'code/api/tests/cards.rs': '// spec: ACC-998\n#[test] fn t() {}\n',
  });
  const { errors } = run(root);
  assert.ok(errors.some((e) => e.includes('ACC-999')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('ACC-998')), errors.join('\n'));
});

test('accepts a valid spec and reports uncovered rules with coverage', () => {
  const root = fixture({
    ...validSpec,
    'code/web/events.test.ts': "test('EVT-001 starts', () => {});\n",
    'code/api/src/lib.rs': '// spec: FRM-001\n',
    'code/api/target/debug/x.rs': '// spec: ZZZ-999\n',
    'code/web/node_modules/pkg/a.test.ts': '// ZZZ-998\n',
  });
  const res = run(root, { coverage: true });
  assert.deepEqual(res.errors, []);
  assert.deepEqual(res.uncovered, ['EVT-002']);
});

test('only recognised test files count as citation sources', () => {
  const root = fixture({
    ...validSpec,
    'code/web/helper.ts': '// EVT-001\n',
    'code/docs/notes.md': 'EVT-002\n',
  });
  const res = run(root, { coverage: true });
  assert.deepEqual(res.errors, []);
  assert.deepEqual(res.uncovered, ['EVT-001', 'EVT-002', 'FRM-001']);
});

test('accepts .test.mjs files as citation sources', () => {
  const root = fixture({
    ...validSpec,
    'code/tools/x.test.mjs': "test('EVT-002 works', () => {});\n",
  });
  const res = run(root, { coverage: true });
  assert.deepEqual(res.uncovered, ['EVT-001', 'FRM-001']);
});

test('skips a code directory that does not exist', () => {
  const root = fixture(validSpec);
  const res = lint({
    specDir: path.join(root, 'spec'),
    codeDirs: [path.join(root, 'nope')],
    coverage: true,
  });
  assert.deepEqual(res.errors, []);
  assert.equal(res.uncovered.length, 3);
});

test('does not mistake well-known tokens like SHA-256 for rule citations', () => {
  const root = fixture({
    ...validSpec,
    'code/api/src/hash.rs': '// uses SHA-256\n',
  });
  assert.deepEqual(run(root).errors, []);
});

test('cli exits 1 with one error per line on stderr', () => {
  const root = fixture({
    ...validSpec,
    'code/web/a.test.ts': '// ACC-999\n',
  });
  const r = spawnSync(
    process.execPath,
    [SCRIPT, '--spec-dir', path.join(root, 'spec'), '--code-dir', path.join(root, 'code')],
    { encoding: 'utf8' },
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /ACC-999/);
});

test('cli exits 0 and prints uncovered ids on stdout with --coverage', () => {
  const root = fixture(validSpec);
  const r = spawnSync(
    process.execPath,
    [SCRIPT, '--coverage', '--spec-dir', path.join(root, 'spec'), '--code-dir', path.join(root, 'code')],
    { encoding: 'utf8' },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.stdout.trim().split('\n'), ['EVT-001', 'EVT-002', 'FRM-001']);
});
