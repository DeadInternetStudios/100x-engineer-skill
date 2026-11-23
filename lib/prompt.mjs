import fs from 'node:fs';
import path from 'node:path';
import { git } from './git.mjs';
import { headingCount, readAsks, readRun, scan, section, sectionLines, stateFile } from './project.mjs';
import { triggerHits } from './triggers.mjs';

// The prompt is the part of .100x/project.md an agent writes for itself before it builds: what to read first, the rules that settle
// trade-offs, the riskiest unknown, the asks with the proof that closes each, the scope, the test material, what not to do, and what the
// judge presses on. skills/100x/references/prompt.md is the guide to writing it. This file is the one list of its sections.
//
// none: the section may say "none: <reason>" instead of holding text, because some problems have nothing to read, no input files or no
// hazard of their own. Every build has rules, a riskiest unknown and a scope, so those three cannot. min: what a written section holds at
// the least, in the guide's own numbers. A count of lines or asks, and a question mark where questions are asked for. It is a count of what
// is there, and cannot tell a good section from a thin one. extra: kept in project.md, but not part of the prompt, so it is not exported.
const ASKS_HINT = `<!-- One line per distinct ask in the brief, constraints and moment requests included. Write each as "- [ ] 1. the ask, and the evidence that will close it".
     Then add one proof ask for each claim the stages cannot see for themselves, then packaging, then stretch asks marked "(stretch)".
     Close each before finishing as "- [x] 1. the ask (evidence: where it lives)" or "- [~] 1. the ask (dropped: the reason)". -->`;

export const SECTIONS = [
  { name: 'Brief', says: `The owner's brief, word for word. Put it in a fenced block when it has lines that start with "## ".` },
  { name: 'Goal', says: 'Start with a verb. One sentence, then what it is and is not, with the examples that make each word mean one thing.' },
  { name: 'Read first', none: true, says: 'One line per source: a path or an address, then what to take from it. Read what the brief names, what is already here, what the owner built that is alike, and the primary sources.' },
  { name: 'Rules', min: { lines: 3, tip: 'Write three to six rules, one per line.' }, says: 'Three to six rules that settle trade-offs, as "X, not Y", each with where it stops.' },
  { name: 'Riskiest unknown', min: { question: true, tip: 'Write the questions the first try answers, and what changes when an answer is no.' }, says: 'One sentence. Then the two or three questions the first try answers, and what changes when an answer is no.' },
  { name: 'Asks', min: { asks: 3 }, hint: ASKS_HINT },
  { name: 'Scope', says: 'What is in, what is out, the platforms and sizes, where each part lives, and what it says plainly it cannot do.' },
  { name: 'Test material', none: true, says: 'The exact inputs to try it on: paths and sizes, what is read only, what is copied before it changes, and what never leaves this folder.' },
  { name: 'Do not', none: true, says: 'The hazards of this problem, and what it may not run, install or write. The standing rules are in the skill, so leave them out.' },
  { name: 'Assumptions', none: true, says: 'One line per thing you decided instead of asking.' },
  { name: 'Must not break', says: 'The one thing that must not be wrong, and its kind from references/must-not-break.md.' },
  { name: 'Moment', says: 'The moment that makes someone say they want this. One sentence.' },
  { name: 'Judge focus', min: { lines: 2, tip: 'Write two to six questions, one per line.' }, says: 'Two to six questions the judge must press, each one answerable by running the thing, such as the math, the first minute or the error messages.' },
  { name: 'Stack and run', extra: true, says: 'Stack, run command, URL.' },
  { name: 'Modifiers', extra: true, says: 'The number phrases in effect and what each one set. Write "none" if there are none.' },
  { name: 'Pre-flight', extra: true, says: 'The lines sent to the owner at the start, as sent.' },
];

// `100x init` writes this file next to the project.md of a run it starts. Its presence is how a run that began with the prompt step is told
// from one that began before it. An agent rewrites project.md whole, so nothing inside it can carry the answer. The text says what the file
// does, so whoever finds it knows, and that deleting it turns the step off, until `100x init` is run again on a run that has not begun.
export const PROMPT_MARKER = 'prompt-step';
export const PROMPT_MARKER_TEXT = 'This run starts with the prompt step, so `100x prompt check` and `100x finish` hold .100x/project.md to it. Delete this file to turn that off. `100x init` writes it again until the run has begun.\n';

const hintOf = (spec) => spec.hint ?? `<!-- ${spec.says}${spec.none ? ' Write "none: <reason>" when there is nothing to put here.' : ''} -->`;

export const projectTemplate = (name) => `# ${name}\n\n${SECTIONS.map((spec) => `## ${spec.name}\n${hintOf(spec)}\n`).join('\n')}`;

const WEAK_REASON = /^(?:n\/?a|not applicable|nothing|none|no|-+)\.?$/i;
const wordCount = (text) => text.split(/\s+/).filter(Boolean).length;
const count = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;

// "none", "None.", "none:" and "none: the reason" say none. "None of the repos are public" is a sentence, so it does not.
const NONE = /^none\b[.!]?[ \t]*(?::[ \t]*([\s\S]*))?$/i;

// What one section of project.md holds: missing, twice, still the hint, a bad or good none, too short, without its question, or text.
// A line of fenced code is a quotation and a subheading is a title, so neither counts toward a section's lines or its question mark,
// the same as a quoted ask is not an ask. A subheading may be indented, as in Markdown.
function readSpec(text, spec) {
  const headings = headingCount(text, spec.name);
  if (headings === 0) return { state: 'missing' };
  if (headings > 1) return { state: 'twice' };
  const lines = sectionLines(text, spec.name);
  const body = lines.map((line) => line.text).join('\n').trim();
  if (!body) return { state: 'hint' };
  const none = NONE.exec(body);
  if (none) {
    const reason = none[1]?.trim();
    if (!reason) return { state: 'bare-none' };
    if (!spec.none) return { state: 'no-none' };
    if (reason.includes('\n')) return { state: 'long-none' };
    if (WEAK_REASON.test(reason) || wordCount(reason) < 3) return { state: 'weak-none', reason };
    return { state: 'none', reason };
  }
  const filled = lines.filter((line) => line.text.trim());
  const own = filled.filter((line) => line.own && !/^[ \t]*#{3,}\s/.test(line.text)).map((line) => line.text);
  if (spec.min?.lines && own.length < spec.min.lines) return { state: 'thin', got: count(own.length, 'line'), skipped: filled.length > own.length };
  if (spec.min?.question && !own.some((line) => line.includes('?'))) return { state: 'no-question' };
  return { state: 'text', body };
}

const orNone = (spec) => (spec.none ? ', or put "none: <reason>" under it' : '');
const MESSAGES = {
  missing: (spec) => `## ${spec.name} is missing in project.md. Write it${orNone(spec)}.`,
  twice: (spec) => `## ${spec.name} is in project.md twice. Keep one.`,
  hint: (spec) => `## ${spec.name} in project.md is still the template's hint. Write it${orNone(spec)}.`,
  'bare-none': (spec) => `## ${spec.name} in project.md says "none" and no reason. Write "none: <the reason, in a few words>".`,
  'no-none': (spec) => `## ${spec.name} in project.md cannot be none. Write it.`,
  'long-none': (spec) => `## ${spec.name} in project.md starts with "none:" and goes on for more lines. Keep the none to one line, or write the section.`,
  'weak-none': (spec, got) => `## ${spec.name} in project.md says none for a reason that says nothing ("${got.reason}"). Say why in a few words, such as "none: nothing like this in the folder".`,
  thin: (spec, got) => `## ${spec.name} in project.md has ${got.got} and needs at least ${spec.min.lines}${got.skipped ? ' (lines in a code fence are a quotation and subheadings are titles, so they do not count)' : ''}. ${spec.min.tip}`,
  'no-question': (spec) => `## ${spec.name} in project.md has no question mark. ${spec.min.tip}`,
};

const asksMessage = (counted, listed) => {
  const has = counted ? `has ${count(counted, 'ask')} that count and needs at least 3` : listed ? 'has no ask that counts' : 'has no ask';
  return `## Asks in project.md ${has}${listed > counted ? ', and dropped asks do not count' : ''}. List each as "- [ ] 1. the ask, and the evidence that will close it".`;
};

const unclosedMessage = ({ kind, line }) => `${kind === 'fence' ? 'A code fence' : 'A comment'} that opens on line ${line} of project.md never closes, so every section after it is hidden. Close it${kind === 'fence' ? ' with a line that holds only the fence marker' : ' with -->'}.`;

// Which way a run is held to the prompt. A mockup runs no judge, and only its moment has to work. A run that began before this step
// has no marker file, and is judged the way it always was.
export function promptStyle(root) {
  if (readRun(root)?.mode === 'mockup') return 'mockup';
  return fs.existsSync(stateFile(root, PROMPT_MARKER)) ? 'prompt' : 'older';
}

export function checkPrompt(root) {
  const file = stateFile(root, 'project.md');
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const style = promptStyle(root);
  const result = { style, problems: [], written: [], none: [], asks: 0 };
  if (style !== 'prompt') return { ...result, ok: true, errors: [] };
  const problem = (name, message) => result.problems.push({ section: name, message });
  const { unclosed } = scan(text);
  if (unclosed) problem('file', unclosedMessage(unclosed));
  for (const spec of SECTIONS.filter((one) => one.extra && headingCount(text, one.name) > 1)) problem(spec.name, MESSAGES.twice(spec));
  for (const spec of SECTIONS.filter((one) => !one.extra)) {
    if (spec.name === 'Asks') {
      const headings = headingCount(text, spec.name);
      const { asks } = readAsks(root);
      result.asks = asks.filter((ask) => ask.status !== 'dropped').length;
      if (headings === 0) problem(spec.name, MESSAGES.missing(spec));
      else if (headings > 1) problem(spec.name, MESSAGES.twice(spec));
      else if (result.asks < spec.min.asks) problem(spec.name, asksMessage(result.asks, asks.length));
      else result.written.push(spec.name);
      continue;
    }
    const got = readSpec(text, spec);
    if (got.state === 'text') result.written.push(spec.name);
    else if (got.state === 'none') result.none.push({ name: spec.name, reason: got.reason });
    else problem(spec.name, MESSAGES[got.state](spec, got));
  }
  const errors = result.problems.map((one) => one.message);
  return { ...result, ok: errors.length === 0, errors };
}

// The text of a section, or nothing when it is empty or says none on one line.
export function writtenSection(text, name) {
  const body = section(text, name);
  const none = NONE.exec(body);
  return none && !none[1]?.includes('\n') ? '' : body;
}

// The exported text starts with the goal and has no title, so it reads as the first message of a chat.
const EXPORT_ORDER = ['Read first', 'Rules', 'Riskiest unknown', 'Asks', 'Scope', 'Test material', 'Do not', 'Assumptions', 'Must not break', 'Moment', 'Judge focus'];
const EXPORT_TITLE = { Assumptions: 'Choices already made' };

// The notes at the end of an ask, "(evidence: x)" or "(dropped: x)", when they are the last things on the line. Brackets inside one nest.
// Text after a note means it is not trailing, and then nothing is cut, because that text may be the ask's own.
function withoutNote(ask) {
  for (const hit of ask.matchAll(/\s*\((?:evidence|dropped)\s*:/gi)) {
    let depth = 0;
    for (let at = hit.index + hit[0].indexOf('('); at < ask.length; at += 1) {
      if (ask[at] === '(') depth += 1;
      else if (ask[at] === ')' && (depth -= 1) === 0) {
        if (ask.slice(at + 1).trim() === '') return withoutNote(ask.slice(0, hit.index));
        break;
      }
    }
  }
  return ask;
}

// "- [ ] 1. the ask (evidence: x)" reads in a chat as "1. the ask". The box and the closing note belong to this run, not to the next
// reader, and an ask that was dropped is not asked. Every other line stays as it was written, and so does fenced code, which is a
// quotation.
function asksAsText(lines) {
  return lines
    .filter(({ text, own }) => !(own && /^\s*[-*]\s+\[~\]/.test(text)))
    .map(({ text, own }) => {
      const box = /^(\s*)[-*]\s+\[[ xX]\]\s+(.*)$/.exec(text);
      return own && box ? `${box[1]}${withoutNote(box[2])}` : text;
    })
    .join('\n')
    .trim();
}

function whereBlock(root, where) {
  const dir = path.resolve(root, where ?? '.');
  let state = '';
  if (!where) {
    const inside = git(root, ['rev-parse', '--is-inside-work-tree']) === 'true';
    const branch = git(root, ['symbolic-ref', '--short', '-q', 'HEAD']);
    const head = git(root, ['rev-parse', '--short', 'HEAD']);
    state = !inside ? ' It is not a git repository yet.' : ` It is a git repository${branch ? ` on branch ${branch}` : ''}${head ? `, at ${head}` : ', with no commits yet'}.`;
  }
  return `WHERE\nWork in ${dir}.${state} Commit locally and often. Never push, force or rewrite published history. Read what this prompt names, and change nothing outside this folder.`;
}

// The prompt as one text to paste after the skill name in another chat. notes: words in the finished text, the WHERE line included,
// that would turn on a mode there.
export function renderPrompt(root, { withBrief = false, where } = {}) {
  const text = fs.readFileSync(stateFile(root, 'project.md'), 'utf8');
  const parts = [section(text, 'Goal'), whereBlock(root, where)];
  for (const name of EXPORT_ORDER) {
    const body = name === 'Asks' ? asksAsText(sectionLines(text, name)) : writtenSection(text, name);
    if (body) parts.push(`${(EXPORT_TITLE[name] ?? name).toUpperCase()}\n${body}`);
  }
  const brief = withBrief ? section(text, 'Brief') : '';
  if (brief) parts.push(`THE OWNER'S WORDS\n${brief}`);
  const out = `${parts.filter(Boolean).join('\n\n')}\n`;
  const notes = triggerHits(out).map((hit) => `Line ${hit.line} has "${hit.found}". After the skill name, that turns on ${hit.turns}.`);
  return { text: out, notes };
}
