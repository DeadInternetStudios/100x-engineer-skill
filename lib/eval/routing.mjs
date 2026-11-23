import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CliError } from '../errors.mjs';
import { globalDir, REPO_ROOT } from '../paths.mjs';
import { parseFrontmatter } from '../validate.mjs';
import { plural, wrap } from './words.mjs';

// A routing eval asks a model to read only the names and descriptions of a list of skills and pick the one a message needs, the way an
// app routes before it loads any skill. A prompt is a message plus the skill it needs, or none. Near-misses are messages that look like
// one skill and belong to another, so a description that grabs too much shows up as a wrong answer.
export const NONE = 'none';
export const TRIGGERS_FILE = path.join(REPO_ROOT, 'evals', 'triggers.json');
export const SETS = ['tune', 'holdout', 'all'];

const fail = (message) => {
  throw new CliError(message);
};

export function loadTriggers(file = TRIGGERS_FILE, { skills = installedSkills() } = {}) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`Could not read the routing prompts at ${file}: ${error.message}`);
  }
  const real = new Set(skills.map((s) => s.name));
  if (data.distractors !== undefined && !Array.isArray(data.distractors)) fail(`${file}: distractors must be a list of { name, description }.`);
  // The answerer reads one list with nothing marking which skill is real, so a distractor with a real skill's name, or another distractor's, makes the list say two things.
  const seenNames = new Set(real);
  for (const distractor of data.distractors ?? []) {
    if (typeof distractor?.name !== 'string' || !distractor.name.trim()) fail(`${file}: a distractor has no name.`);
    if (seenNames.has(distractor.name)) fail(`${file}: the distractor "${distractor.name}" has the name of ${real.has(distractor.name) ? 'a skill in skills/' : 'another distractor'}, so the list a model chooses from would hold it twice.`);
    seenNames.add(distractor.name);
  }
  const names = new Set([...real, ...(data.distractors ?? []).map((d) => d.name)]);
  const ids = new Set();
  for (const prompt of data.prompts ?? []) {
    const where = `${file}, prompt ${prompt.id ?? '(no id)'}`;
    if (!prompt.id || ids.has(prompt.id)) fail(`${where}: the id is missing or repeated.`);
    ids.add(prompt.id);
    if (!['tune', 'holdout'].includes(prompt.set)) fail(`${where}: set is "${prompt.set}", it must be tune or holdout.`);
    if (typeof prompt.text !== 'string' || !prompt.text.trim()) fail(`${where}: the text is empty.`);
    if (prompt.expect !== null && !names.has(prompt.expect)) fail(`${where}: expect "${prompt.expect}" is not a skill or a distractor. Use null for no skill.`);
    if (prompt.near !== undefined && !real.has(prompt.near)) fail(`${where}: near "${prompt.near}" is not a skill in skills/.`);
  }
  return data;
}

export function installedSkills(root = REPO_ROOT) {
  const dir = path.join(root, 'skills');
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, 'SKILL.md')))
    .map((entry) => {
      const { data } = parseFrontmatter(fs.readFileSync(path.join(dir, entry.name, 'SKILL.md'), 'utf8'));
      return { name: entry.name, description: String(data.description ?? '') };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function selectPrompts(triggers, set) {
  if (!SETS.includes(set)) fail(`--set is tune, holdout or all. Got "${set}".`);
  const chosen = triggers.prompts.filter((prompt) => set === 'all' || prompt.set === set);
  if (chosen.length === 0) fail(`The ${set} set holds no messages, so there is nothing to stage or score. An accuracy over 0 messages is no number.`);
  return chosen;
}

// The list a model chooses from: the real skills and the distractors in one alphabetical list, with nothing marking which is which.
export function skillList(triggers, skills = installedSkills()) {
  return [...skills, ...(triggers.distractors ?? [])].map(({ name, description }) => ({ name, description })).sort((a, b) => a.name.localeCompare(b.name));
}

export const descriptionHash = (list) => crypto.createHash('sha256').update(JSON.stringify(list)).digest('hex').slice(0, 12);

// The example in ask.md uses the first two ids of the set staged, so a model that copies its shape keys the answers by ids that exist.
export const ASK = (count, skills, [first = 'p-001', second = 'p-002'] = []) => `# Pick the skill

skills.json lists ${skills} skills, each with a name and a description. prompts.json lists ${count} messages that people sent to a coding agent.

For each message, pick the one skill the agent should load to handle it, or "none" when no listed skill fits. Judge from the names and descriptions only.
Do not open any other file on this machine, and do not look for the answers. Answer each message by itself, as if you had not seen the others.

Write answers.json next to this file, one key per message id, the value a skill name from skills.json or "none":

{ "${first}": "some-skill", "${second}": "none" }

Reply when it is written.
`;

// Writes what a model needs to answer and nothing it could answer from. The answers stay in evals/triggers.json.
export function stage(outDir, { set = 'tune', file = TRIGGERS_FILE, skills: real = installedSkills() } = {}) {
  const triggers = loadTriggers(file, { skills: real });
  const prompts = selectPrompts(triggers, set);
  const skills = skillList(triggers, real);
  if (fs.existsSync(outDir) && !fs.statSync(outDir).isDirectory()) fail(`${outDir} is a file, not a folder. Name a folder to stage into.`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'prompts.json'), `${JSON.stringify(prompts.map(({ id, text }) => ({ id, text })), null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, 'skills.json'), `${JSON.stringify(skills, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, 'ask.md'), ASK(prompts.length, skills.length, prompts.map(({ id }) => id)));
  return { prompts: prompts.length, skills: skills.length, hash: descriptionHash(skills) };
}

// A long list of misses stops here in the terminal. --all lists every one, and --json always carries them.
export const WRONG_SHOWN = 15;

const ratio = (top, bottom) => (bottom === 0 ? null : top / bottom);

export function scoreRouting(triggers, answers, { set = 'tune', skills: real = installedSkills() } = {}) {
  const prompts = selectPrompts(triggers, set);
  const skills = skillList(triggers, real);
  const listed = new Set([...skills.map((s) => s.name), NONE]);
  const table = new Map();
  const row = (name) => {
    if (!table.has(name)) table.set(name, { expected: 0, answered: 0, tp: 0, fp: 0, fn: 0 });
    return table.get(name);
  };
  const wrong = [];
  const unlisted = [];
  let correct = 0;
  let unanswered = 0;
  for (const prompt of prompts) {
    const expected = prompt.expect ?? NONE;
    const given = answers[prompt.id];
    if (given !== undefined && given !== null && typeof given !== 'string') fail(`The answer for ${prompt.id} must be a skill name or "none" as a string. Got ${JSON.stringify(given)}.`);
    const answered = given === undefined || given === null ? null : given.trim();
    row(expected).expected += 1;
    if (answered === null) unanswered += 1;
    if (answered !== null && listed.has(answered)) row(answered).answered += 1;
    if (answered === expected) {
      correct += 1;
      row(expected).tp += 1;
      continue;
    }
    row(expected).fn += 1;
    if (answered !== null && !listed.has(answered)) unlisted.push({ id: prompt.id, answered });
    if (answered !== null && listed.has(answered)) row(answered).fp += 1;
    wrong.push({ id: prompt.id, text: prompt.text, expected, answered, ...(prompt.near ? { near: prompt.near } : {}) });
  }
  const classes = Object.fromEntries([...table].sort(([a], [b]) => a.localeCompare(b)).map(([name, c]) => [name, { ...c, precision: ratio(c.tp, c.tp + c.fp), recall: ratio(c.tp, c.tp + c.fn) }]));
  // Ids in the answers that name no message of this set. A file keyed by the wrong ids scores as nothing answered.
  const ids = new Set(prompts.map((prompt) => prompt.id));
  const unmatched = Object.keys(answers).filter((id) => !ids.has(id));
  return { set, prompts: prompts.length, correct, accuracy: ratio(correct, prompts.length), unanswered, descriptions: descriptionHash(skills), classes, wrong, unlisted, unmatched };
}

// A scored run kept as one file, so a number in a report can be worked out again by anyone: the list the model chose from, the messages
// with the answers they needed, and what the model answered. Replaying it reads nothing else, so a later edit to the prompts or the
// descriptions cannot move a number that was already reported.
export function freezeRun({ set, answerer = null, triggers, answers, skills }) {
  const prompts = selectPrompts(triggers, set);
  const list = skillList(triggers, skills);
  return {
    version: 1,
    set,
    answerer,
    descriptions: descriptionHash(list),
    savedAt: new Date().toISOString(),
    skills: list,
    prompts: prompts.map(({ id, text, expect, near }) => ({ id, text, expect: expect ?? null, ...(near ? { near } : {}) })),
    answers: Object.fromEntries(prompts.filter(({ id }) => answers[id] !== undefined).map(({ id }) => [id, answers[id]])),
  };
}

export function replayRun(bundle, where = 'the saved run') {
  const shapeError = !bundle || bundle.version !== 1 || !SETS.includes(bundle.set) || !Array.isArray(bundle.skills) || !Array.isArray(bundle.prompts) || typeof bundle.answers !== 'object' || bundle.answers === null;
  if (shapeError) fail(`${where} is not a saved routing run (version 1 with set, skills, prompts and answers).`);
  const badPrompt = bundle.prompts.find((prompt) => typeof prompt?.id !== 'string' || typeof prompt.text !== 'string' || (prompt.expect !== null && typeof prompt.expect !== 'string'));
  if (badPrompt) fail(`${where} holds a message without an id, a text or an expected skill: ${JSON.stringify(badPrompt)}.`);
  const triggers = { prompts: bundle.prompts.map((prompt) => ({ ...prompt, set: bundle.set })), distractors: [] };
  return scoreRouting(triggers, bundle.answers, { set: bundle.set, skills: bundle.skills });
}

// The holdout is the one look that counts, and a second look at the same set is a tuned set. Every look is written down so the report can say which one it is.
const looksFile = () => path.join(globalDir(), 'evals', 'holdout-looks.tsv');

export function recordHoldoutLook(result) {
  const file = looksFile();
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length : 0;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${new Date().toISOString()}\t${result.descriptions}\t${result.prompts}\t${result.correct}\n`);
  return before + 1;
}

const show = (value) => (value === null ? '-' : value.toFixed(3));

const nearWords = (w) => (!w.near ? '' : w.near === w.answered ? `, the near-miss this message was written to test` : `, written to be confused with ${w.near}`);

export function routingReport(result, { look = null, all = false } = {}) {
  const lines = [`Routing, ${result.set} set. ${result.correct} of ${result.prompts} right, accuracy ${show(result.accuracy)}${result.unanswered ? `, ${result.unanswered} unanswered` : ''}. Descriptions ${result.descriptions} (a hash of the descriptions scored).`];
  if (look) lines.push(look === 1 ? 'This is the first look at the holdout.' : `This is look ${look} at the holdout. It is spent, and a number from it is a tuned number.`);
  if (result.unmatched?.length && result.unanswered) lines.push('', wrap(`${plural(result.unmatched.length, 'id')} in the answers ${result.unmatched.length === 1 ? 'matches' : 'match'} no message in the ${result.set} set (${result.unmatched.slice(0, 3).map((id) => `"${id}"`).join(', ')}${result.unmatched.length > 3 ? ', ...' : ''}). Check that the answers are keyed by the ids in prompts.json.`));
  if (result.unlisted?.length) lines.push('', wrap(`${plural(result.unlisted.length, 'answer')} named no skill in the list and scored as a miss, so a typo reads as a wrong pick: ${result.unlisted.slice(0, 5).map((u) => `${u.id} "${u.answered}"`).join(', ')}${result.unlisted.length > 5 ? `, and ${result.unlisted.length - 5} more` : ''}.`));
  // Messages with no answer are one line and not a list, unless asked for. They are not choices the model made.
  const answered = result.wrong.filter((w) => w.answered !== null);
  const silent = result.wrong.length - answered.length;
  const shown = all ? result.wrong : answered.slice(0, WRONG_SHOWN);
  if (shown.length) {
    lines.push('', 'Wrong answers');
    for (const w of shown) lines.push(`${w.id}  ${wrap(`"${w.text}"`, { width: 96, indent: '    ' })}\n    needed ${w.expected}, answered ${w.answered ?? 'nothing'}${nearWords(w)}`);
  }
  if (!all && answered.length > shown.length) lines.push(`  and ${answered.length - shown.length} more wrong answers. --all lists every one, and --json carries them.`);
  if (!all && silent) lines.push(`  ${plural(silent, 'message')} ${silent === 1 ? 'has' : 'have'} no answer. --all lists ${silent === 1 ? 'it' : 'them'}.`);
  // The wrong answers are what the next edit is made from, so they come first. The table of every skill follows, with what each column counts.
  lines.push('', wrap('Per skill. expected: messages that needed it. answered: times it was picked. precision: of the picks, the share that were right. recall: of the messages that needed it, the share it got. A dash means it was never picked.', { width: 96 }), '', `${'class'.padEnd(18)}${'expected'.padStart(9)}${'answered'.padStart(9)}${'precision'.padStart(11)}${'recall'.padStart(9)}`);
  for (const [name, c] of Object.entries(result.classes)) lines.push(`${name.padEnd(18)}${String(c.expected).padStart(9)}${String(c.answered).padStart(9)}${show(c.precision).padStart(11)}${show(c.recall).padStart(9)}`);
  return `${lines.join('\n')}\n`;
}
