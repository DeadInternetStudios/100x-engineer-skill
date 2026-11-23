import fs from 'node:fs';
import path from 'node:path';

// The Agent Skills specification (https://agentskills.io/specification), as far as a file check can hold it. `npx skills-ref validate skills/<name>` is the
// reference check. This file reads the block style the repo writes, with a line for each key, so it fails flow style such as `metadata: {a: "b"}` that YAML and the
// reference accept, and it fails tab indentation as the reference does. The body size and bundled-file rules are ones the spec only recommends.
export const SPEC_FIELDS = ['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools'];
export const NAME_LIMIT = 64;
export const DESCRIPTION_LIMIT = 1024;
export const COMPATIBILITY_LIMIT = 500;
export const BODY_TOKEN_LIMIT = 5000;
export const BODY_LINE_LIMIT = 500;
const NAME_SHAPE = /^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u;
// A plain value YAML reads as a boolean, null or number. A metadata value must be a string, so it needs quotes.
const NOT_A_STRING = /^(?:true|false|yes|no|on|off|null|~|[-+]?\d[\d_]*(?:\.\d*)?(?:[eE][-+]?\d+)?|0x[0-9a-f]+|0o[0-7]+|\.inf|\.nan)$/i;
const BLOCK_SCALARS = ['>', '|', '>-', '|-', '>+', '|+'];

function scalar(key, text) {
  const value = text.trim();
  if (value.startsWith('"')) {
    if (!/^"(?:[^"\\]|\\.)*"$/.test(value)) return { problem: `a double quoted ${key} cannot hold an unescaped double quote` };
    try {
      return { value: JSON.parse(value), quoted: true };
    } catch {
      return { value: value.slice(1, -1), quoted: true };
    }
  }
  if (value.startsWith("'")) {
    if (!/^'(?:[^']|'')*'$/.test(value)) return { problem: `a single quoted ${key} must double each apostrophe in it` };
    return { value: value.slice(1, -1).replaceAll("''", "'"), quoted: true };
  }
  if (BLOCK_SCALARS.includes(value) || value === '') return { value, quoted: false };
  if (/:(\s|$)/.test(value)) return { problem: `a plain ${key} cannot hold a colon and a space, YAML reads it as a new key. Put the ${key} in double quotes` };
  if (/\s#/.test(value)) return { problem: `a plain ${key} cannot hold a space and #, YAML reads it as a comment. Put the ${key} in double quotes` };
  if (/^[[\]{}&*!|>%@`,#]/.test(value)) return { problem: `a plain ${key} cannot start with ${value[0]}. Put the ${key} in double quotes` };
  return { value, quoted: false };
}

// The front matter of a SKILL.md as the spec allows it: top level `key: value` lines, and `metadata:` as a block of `key: value` lines under it.
// `fields` holds the top level values as text. `metadata` is the mapping, or null when the file has none. `problems` names what a YAML loader would
// reject or what the spec does not allow, one sentence each.
export function parseSkillFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!match) return null;
  const fields = {};
  const problems = [];
  let metadata = null;
  let inMetadata = false;
  let last = null;
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const top = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(line);
    if (top) {
      const [, key, rest] = top;
      if (key in fields) problems.push(`the key ${key} is given twice`);
      last = key;
      inMetadata = key === 'metadata' && rest.trim() === '';
      if (inMetadata) metadata = {};
      else if (key === 'metadata') problems.push('metadata must be a block of key: value lines under "metadata:"');
      const parsed = key === 'metadata' ? {} : scalar(key, rest);
      if (parsed.problem) problems.push(parsed.problem);
      fields[key] = parsed.value ?? '';
      continue;
    }
    if (!/^[ \t]/.test(line)) {
      problems.push(`the line "${line.trim().slice(0, 40)}" is not a key: value pair`);
      continue;
    }
    if (/^ *\t/.test(line)) {
      problems.push('tab characters must not be used in indentation, use spaces');
      continue;
    }
    const nested = /^[ \t]+([A-Za-z0-9_.-]+):[ \t]*(.*)$/.exec(line);
    if (inMetadata && nested) {
      const parsed = scalar(`metadata ${nested[1]}`, nested[2]);
      if (parsed.problem) problems.push(parsed.problem);
      else if (parsed.value === '' || BLOCK_SCALARS.includes(parsed.value)) problems.push(`metadata ${nested[1]} must be a one line string`);
      else if (!parsed.quoted && NOT_A_STRING.test(parsed.value)) problems.push(`metadata ${nested[1]} is ${parsed.value}, which YAML reads as a boolean or a number. Put it in double quotes, because metadata values are strings`);
      if (nested[1] in metadata) problems.push(`metadata ${nested[1]} is given twice`);
      metadata[nested[1]] = parsed.value ?? '';
    } else if (!BLOCK_SCALARS.includes(fields[last])) {
      problems.push(`${last} runs over more than one line. Keep each value on one line`);
    }
  }
  return { fields, metadata, problems, raw: match[1], body: text.slice(match[0].length) };
}

// The older flat view: name and description as text. Routing reads the descriptions through it.
export function parseFrontmatter(text) {
  const parsed = parseSkillFrontmatter(text);
  return parsed && { data: parsed.fields, raw: parsed.raw, body: parsed.body };
}

// Four characters to a token is the rule of thumb the spec's own guidance uses.
export const estimateTokens = (text) => Math.ceil(text.length / 4);

// What a skill folder may not do: name a file outside itself. `../100x/references/apps.md` works when the whole suite sits side by side and breaks the
// moment `npx skills add --skill` installs one skill alone.
const SIBLING_PATH = /\.\.\/([A-Za-z0-9][A-Za-z0-9_.-]*)\/(?:SKILL\.md|references\/|assets\/|[A-Za-z0-9_./-]+)/g;
// A skill is named like this: the `100x-judge` skill. The name has to be a skill of the repo.
const SKILL_NAMED = /`(100x(?:-[a-z0-9]+)*)` skill\b/g;

export function specFindings({ name, text, dir, siblings = [] }) {
  const out = [];
  const add = (rule, message) => out.push({ rule, message });
  const front = parseSkillFrontmatter(text);
  if (!front) return out;
  const { fields, metadata } = front;
  for (const problem of front.problems) add('frontmatter-yaml', problem);

  if (fields.name) {
    if (fields.name.length > NAME_LIMIT) add('spec-name', `name is ${fields.name.length} characters, limit ${NAME_LIMIT}`);
    if (fields.name !== fields.name.toLowerCase() || !NAME_SHAPE.test(fields.name)) add('spec-name', `name "${fields.name}" must be lowercase letters, digits and single hyphens, with no hyphen at either end and no "--"`);
  }
  if (!fields.name) add('spec-name', 'name is required');
  else if (fields.name !== name) add('name-matches-folder', `name "${fields.name}" must equal folder "${name}"`);
  if (fields.license !== undefined && !fields.license.trim()) add('spec-license', 'license is empty. Name a license or its file, or drop the key');
  if (fields.compatibility !== undefined && (fields.compatibility.length < 1 || fields.compatibility.length > COMPATIBILITY_LIMIT)) add('spec-compatibility', `compatibility is ${fields.compatibility.length} characters, it must be 1 to ${COMPATIBILITY_LIMIT}`);
  if (fields['allowed-tools'] !== undefined && /[,[\]]/.test(fields['allowed-tools'])) add('spec-allowed-tools', 'allowed-tools is one space separated string, such as "Read Grep", not a list');
  if (metadata && Object.keys(metadata).length === 0) add('spec-metadata', 'metadata has no entries. Add key: value lines under it, or drop the key');
  for (const key of Object.keys(fields)) if (!SPEC_FIELDS.includes(key) && key !== 'disable-model-invocation') add('frontmatter-key', `unknown key "${key}". The spec allows ${SPEC_FIELDS.join(', ')}. Anything else goes under metadata`);

  const lines = text.split('\n').length;
  if (lines > BODY_LINE_LIMIT) add('spec-body-lines', `${lines} lines, the spec asks for under ${BODY_LINE_LIMIT}`);
  const tokens = estimateTokens(front.body);
  if (tokens > BODY_TOKEN_LIMIT) add('spec-body-tokens', `the body is about ${tokens} tokens, the spec asks for under ${BODY_TOKEN_LIMIT}. Move detail into references/`);

  for (const file of docsOf(dir)) {
    const rel = path.relative(dir, file).split(path.sep).join('/');
    const content = fs.readFileSync(file, 'utf8');
    if (siblings.length) skillNames(content, siblings, rel, add);
    for (const hit of new Set(content.match(SIBLING_PATH) ?? [])) {
      const [, first, next] = hit.split('/');
      if (siblings.includes(first) || next === 'SKILL.md' || /^(references|assets)$/.test(next)) add('spec-escape', `${rel} names ${hit}, a file outside ${name}. A skill reads only its own files. Name another skill by its name, or print a shared reference with \`100x ref <name>\``);
    }
  }
  return out;
}

function skillNames(text, siblings, rel, add) {
  for (const named of new Set([...text.matchAll(SKILL_NAMED)].map((m) => m[1]))) if (!siblings.includes(named)) add('skill-unknown', `${rel} names the \`${named}\` skill, and this repo has no such skill`);
}

function docsOf(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...docsOf(full));
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out.sort();
}
