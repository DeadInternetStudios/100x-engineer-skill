#!/usr/bin/env node
// A routing answerer that runs on a Cursor model through the Cursor SDK, one `100x helper run` for each message. The model is the one you name, and the
// receipt of every call says which model ran. It is not an app's own router. It is a model that did not write the holdout reading the same list.
//   answer <dir>   read prompts.json and skills.json from `100x eval triggers stage`, write answers.json, answers-meta.json and receipts/ next to them
// Flags: --model <id> (default muse-wonder-1.0), --effort <level> (default max), --context <size> (default 300k), --parallel <n> (default 3, never above subagents.atOnce),
//        --bin <path to bin/100x.mjs> (default the one in this repo), --seed <n> (list order), --minutes <n> (per message, default 5),
//        --gap <seconds> (least time between two helper starts, default 3.5, because each start asks the SDK for its model list and the SDK allows 30 of those a minute),
//        --wait <seconds> (how long to wait after the SDK says the rate limit is reached, default 65)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { load } from '../../lib/config.mjs';

const { values, positionals } = parseArgs({ allowPositionals: true, options: { model: { type: 'string', default: 'muse-wonder-1.0' }, effort: { type: 'string', default: 'max' }, context: { type: 'string', default: '300k' }, parallel: { type: 'string', default: '3' }, bin: { type: 'string', default: fileURLToPath(new URL('../../bin/100x.mjs', import.meta.url)) }, seed: { type: 'string', default: '1' }, minutes: { type: 'string', default: '5' }, gap: { type: 'string', default: '3.5' }, wait: { type: 'string', default: '65' } } });
const [job, dir] = positionals;
if (job !== 'answer' || !dir) {
  console.error('node evals/runners/cursor-sdk.mjs answer <dir> [--model muse-wonder-1.0 --effort max --context 300k --parallel 3]');
  process.exit(2);
}
const seed = Number(values.seed);
// The owner's cap on helpers at the same time (subagents.atOnce, itself held under helper.ceiling) wins over --parallel, as it does for a night.
const asked = Number(values.parallel);
if (!Number.isInteger(asked) || asked < 1) { console.error('--parallel must be a whole number, 1 or more.'); process.exit(1); }
const atOnce = load().effective.subagents.atOnce;
const parallel = Math.min(asked, atOnce);
if (parallel < asked) console.error(`--parallel ${asked} is above subagents.atOnce (${atOnce}), so ${parallel} run at once.`);

// The list is shuffled for each message, from the message's own id, the same way the ollama runner does it.
const rng = (text) => {
  let state = [...`${seed}:${text}`].reduce((hash, char) => (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0, 7);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const shuffled = (list, text) => {
  const next = rng(text);
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

const root = path.resolve(dir);
const prompts = JSON.parse(fs.readFileSync(path.join(root, 'prompts.json'), 'utf8'));
const skills = JSON.parse(fs.readFileSync(path.join(root, 'skills.json'), 'utf8'));
const names = new Set([...skills.map((s) => s.name), 'none']);
const where = { tasks: path.join(root, 'tasks'), receipts: path.join(root, 'receipts'), logs: path.join(root, 'logs'), empty: fs.mkdtempSync(path.join(os.tmpdir(), 'route-empty-')) };
for (const folder of [where.tasks, where.receipts, where.logs]) fs.mkdirSync(folder, { recursive: true });

const task = (prompt) => {
  const listing = shuffled(skills, prompt.id).map((s) => `- ${s.name}: ${s.description}`).join('\n');
  return `You are the skill router of a coding agent. These skills are installed. You see only their names and descriptions.\n\n${listing}\n\nA user sends this message:\n"""\n${prompt.text}\n"""\n\nReply with the name of the one skill the agent should load to handle it, or "none" when no listed skill fits. Use no tools and read no files. Your whole reply is one JSON object, like {"skill":"<name or none>"}.`;
};

// The last JSON object in the reply that names a listed skill or "none".
const skillOf = (text) => {
  for (const match of [...String(text).matchAll(/\{[^{}]*\}/g)].reverse()) {
    try {
      const skill = JSON.parse(match[0]).skill;
      if (names.has(skill)) return skill;
    } catch {}
  }
  return null;
};

const sleep = (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));
// Starts are spaced by the gap, whichever worker asks first.
let nextStart = 0;
const turn = async () => {
  const at = Math.max(Date.now(), nextStart);
  nextStart = at + Number(values.gap) * 1000;
  await sleep((at - Date.now()) / 1000);
};

const helper = (id) => new Promise((resolve) => {
  const file = path.join(where.tasks, `${id}.md`);
  const receipt = path.join(where.receipts, `${id}.json`);
  const args = [values.bin, 'helper', 'run', '--model', values.model, '--effort', values.effort, '--context', values.context, '--task-file', file, '--cwd', where.empty, '--minutes', values.minutes, '--receipt', receipt, '--json'];
  const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout.on('data', (chunk) => { out += chunk; });
  child.stderr.on('data', (chunk) => { err += chunk; });
  child.on('close', (code) => {
    fs.writeFileSync(path.join(where.logs, `${id}.json`), out);
    if (err) fs.writeFileSync(path.join(where.logs, `${id}.err`), err);
    resolve({ code, out, limited: /rate limit/i.test(err) });
  });
});

// A message answered in an earlier run of this folder is kept, so a run that stopped can be started again.
const kept = (id) => {
  try {
    const log = JSON.parse(fs.readFileSync(path.join(where.logs, `${id}.json`), 'utf8'));
    return log.exitCode === 0 && fs.existsSync(path.join(where.receipts, `${id}.json`)) ? skillOf(log.text) : null;
  } catch {
    return null;
  }
};

const answers = {};
const failed = [];
const started = Date.now();
const queue = prompts.filter((p) => p.id);
let done = 0;

async function worker() {
  while (queue.length) {
    const prompt = queue.shift();
    fs.writeFileSync(path.join(where.tasks, `${prompt.id}.md`), task(prompt));
    let skill = kept(prompt.id);
    let last = null;
    let waits = 0;
    for (let attempt = 1; attempt <= 3 && skill === null; attempt += 1) {
      await turn();
      last = await helper(prompt.id);
      if (last.limited && waits < 10) {
        // The SDK refused to start it. That is not an answer, so it is not one of the three tries, up to ten times.
        waits += 1;
        console.log(`${prompt.id}: the SDK's rate limit was reached, waiting ${values.wait} s`);
        await sleep(Number(values.wait));
        attempt -= 1;
        continue;
      }
      if (last.code === 3) throw new Error(`${prompt.id}: the SDK reports another model than the one asked for. Stopping.`);
      if (last.code === 0) {
        try {
          skill = skillOf(JSON.parse(last.out).text);
        } catch {}
      }
    }
    if (skill === null) failed.push({ id: prompt.id, code: last?.code ?? null });
    else answers[prompt.id] = skill;
    done += 1;
    if (done % 10 === 0 || done === prompts.length) console.log(`${done} of ${prompts.length} messages answered, ${Math.round((Date.now() - started) / 1000)} s`);
  }
}

try {
  await Promise.all(Array.from({ length: parallel }, worker));
} catch (error) {
  fs.rmSync(where.empty, { recursive: true, force: true });
  console.error(error.message);
  process.exit(1);
}
fs.rmSync(where.empty, { recursive: true, force: true });
if (failed.length) {
  console.error(`${failed.length} messages got no usable answer in three tries (${failed.map((f) => f.id).sort().join(', ')}). Nothing was written. Run it again: the messages that were answered are kept. The logs are in ${where.logs}.`);
  process.exit(1);
}

const receipts = prompts.map((p) => JSON.parse(fs.readFileSync(path.join(where.receipts, `${p.id}.json`), 'utf8')));
const models = [...new Set(receipts.map((r) => `${r.ran?.id} ${JSON.stringify(r.ran?.params)}`))];
const sorted = Object.fromEntries(prompts.map((p) => [p.id, answers[p.id]]));
fs.writeFileSync(path.join(root, 'answers.json'), `${JSON.stringify(sorted, null, 2)}\n`);
fs.writeFileSync(path.join(root, 'answers-meta.json'), `${JSON.stringify({ runner: 'evals/runners/cursor-sdk.mjs', through: '100x helper run, the Cursor SDK', model: values.model, effort: values.effort, context: values.context, ranAs: models, modelChecks: [...new Set(receipts.map((r) => r.modelCheck))], seed, shuffled: true, prompts: prompts.length, tokens: receipts.reduce((sum, r) => sum + (r.tokens ?? 0), 0), seconds: Math.round((Date.now() - started) / 1000), parallel, at: new Date().toISOString() }, null, 2)}\n`);
console.log(`${prompts.length} answers from ${values.model} (${models.join('; ')}) in ${Math.round((Date.now() - started) / 1000)} s, written to ${path.join(root, 'answers.json')}`);
