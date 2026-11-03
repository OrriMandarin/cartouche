#!/usr/bin/env node
// Spec linter: checks the rule IDs defined in spec/ and the citations found in tests.
// Pure Node, no dependency. See spec/README.md for the rule format.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');

const RULE_DEF = /^- \*\*([A-Z]{3}-\d{3})\*\* — /;
// A list item that starts like a rule definition but does not follow the format.
const RULE_LIKE = /^- \*\*([A-Z]{3}-\S*)\*\*/;
const RULE_ID_G = /(?<![A-Za-z0-9-])[A-Z]{3}-\d{3}(?![A-Za-z0-9])/g;

// Well-known tokens shaped like a rule ID (e.g. SHA-256) that are never citations.
const NON_RULE_PREFIXES = new Set(['SHA', 'RFC', 'ISO', 'AES', 'RSA', 'UTF', 'CVE']);

const IGNORED_DIRS = new Set(['node_modules', 'target', '.next', '.git', 'dist']);
const TEST_FILE = /\.(test|spec)\.(ts|tsx|mjs|js)$/;

function findIds(line) {
  return [...line.matchAll(RULE_ID_G)]
    .map((m) => ({ id: m[0], index: m.index }))
    .filter(({ id }) => !NON_RULE_PREFIXES.has(id.slice(0, 3)));
}

function parseReadmeTable(readmePath, errors) {
  const table = new Map(); // file -> prefix
  const prefixOwner = new Map(); // prefix -> file
  const lines = fs.readFileSync(readmePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim().replace(/[`()]/g, ''));
    if (cells.length < 2 || !/^[\w.-]+\.md$/.test(cells[0])) continue; // header, separator, other tables
    const [file, prefix] = cells;
    if (!/^[A-Z]{3}$/.test(prefix)) {
      errors.push(`spec/README.md: invalid prefix "${prefix}" for ${file} (expected 3 capital letters)`);
      continue;
    }
    if (table.has(file)) errors.push(`spec/README.md: ${file} is listed twice in the prefix table`);
    if (prefixOwner.has(prefix)) {
      errors.push(`spec/README.md: prefix ${prefix} is used twice in the prefix table (${prefixOwner.get(prefix)} and ${file})`);
    }
    table.set(file, prefix);
    prefixOwner.set(prefix, file);
  }
  return table;
}

function collectSpec(specDir, errors) {
  const defined = new Map(); // id -> "file:line"
  const mentions = []; // { id, where }
  const readme = path.join(specDir, 'README.md');
  if (!fs.existsSync(readme)) {
    errors.push(`${specDir}: README.md not found`);
    return { defined, mentions };
  }
  const table = parseReadmeTable(readme, errors);

  const files = fs.readdirSync(specDir).filter((f) => f.endsWith('.md')).sort();
  for (const file of table.keys()) {
    if (!files.includes(file)) errors.push(`spec/README.md: ${file} is listed in the prefix table but does not exist`);
  }
  for (const file of files) {
    const isTopic = file !== 'README.md' && file !== 'glossary.md';
    if (isTopic && !table.has(file)) {
      errors.push(`spec/${file}: file is missing from the prefix table in spec/README.md`);
    }
    const expected = table.get(file);
    const lines = fs.readFileSync(path.join(specDir, file), 'utf8').split(/\r?\n/);
    let inFence = false;
    lines.forEach((line, i) => {
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        return;
      }
      if (inFence) return; // format examples in fenced blocks are not rules
      const where = `spec/${file}:${i + 1}`;
      let skipFirst = false;
      const def = RULE_DEF.exec(line);
      if (def) {
        skipFirst = true;
        const id = def[1];
        if (expected && id.slice(0, 3) !== expected) {
          errors.push(`${where}: ${id} has prefix ${id.slice(0, 3)} but ${file} uses prefix ${expected}`);
        } else if (!expected) {
          errors.push(`${where}: ${id} is defined in a file without a prefix in the README table`);
        }
        if (defined.has(id)) errors.push(`${where}: duplicate rule id ${id} (first defined at ${defined.get(id)})`);
        else defined.set(id, where);
      } else {
        const bad = RULE_LIKE.exec(line);
        if (bad) errors.push(`${where}: malformed rule definition "${bad[1]}" (expected "- **XXX-NNN** — text")`);
      }
      const ids = findIds(line);
      ids.slice(skipFirst ? 1 : 0).forEach(({ id }) => mentions.push({ id, where }));
    });
  }
  return { defined, mentions };
}

function* walk(dir, rootDir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (full === SCRIPT_DIR) continue; // the linter's own fixtures never count
      yield* walk(full, rootDir);
    } else if (entry.isFile()) {
      yield path.join(dir, entry.name);
    }
  }
}

function isTestSource(file, codeDir) {
  if (TEST_FILE.test(file)) return true;
  if (file.endsWith('.rs')) {
    const segments = [path.basename(codeDir), ...path.relative(codeDir, file).split(path.sep)];
    return segments.includes('tests') || segments.includes('src');
  }
  return false;
}

function collectCitations(codeDirs) {
  const citations = []; // { id, where }
  for (const codeDir of codeDirs) {
    if (!fs.existsSync(codeDir) || !fs.statSync(codeDir).isDirectory()) continue;
    for (const file of walk(codeDir, codeDir)) {
      if (!isTestSource(file, codeDir)) continue;
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
      lines.forEach((line, i) => {
        for (const { id } of findIds(line)) {
          citations.push({ id, where: `${path.relative(process.cwd(), file)}:${i + 1}` });
        }
      });
    }
  }
  return citations;
}

export function lint({ specDir, codeDirs = [], coverage = false }) {
  const errors = [];
  const { defined, mentions } = collectSpec(specDir, errors);

  for (const { id, where } of mentions) {
    if (!defined.has(id)) errors.push(`${where}: reference to unknown rule ${id}`);
  }

  const citations = collectCitations(codeDirs);
  const cited = new Set();
  for (const { id, where } of citations) {
    if (defined.has(id)) cited.add(id);
    else errors.push(`${where}: citation of unknown rule ${id}`);
  }

  const uncovered = coverage ? [...defined.keys()].filter((id) => !cited.has(id)).sort() : [];
  return { errors, uncovered };
}

function parseArgs(argv) {
  const opts = { coverage: false, specDir: path.join(REPO_ROOT, 'spec'), codeDirs: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--coverage') opts.coverage = true;
    else if (a === '--spec-dir') opts.specDir = path.resolve(argv[++i]);
    else if (a === '--code-dir') (opts.codeDirs ??= []).push(path.resolve(argv[++i]));
    else throw new Error(`unknown argument: ${a}`);
  }
  opts.codeDirs ??= ['backend', 'frontend'].map((d) => path.join(REPO_ROOT, d));
  return opts;
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    process.exit(2);
  }
  const { errors, uncovered } = lint(opts);
  if (errors.length > 0) {
    process.stderr.write(`${errors.join('\n')}\n`);
    process.exit(1);
  }
  if (opts.coverage && uncovered.length > 0) process.stdout.write(`${uncovered.join('\n')}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
