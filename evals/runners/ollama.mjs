#!/usr/bin/env node
// A stand-in model for the routing eval, run on this machine through ollama. It is not the model an app routes with, and a number from it says so.
// Two jobs, both with the output forced to a fixed shape so the model cannot answer in free text:
//   answer  <dir>              read prompts.json and skills.json from `100x eval triggers stage`, write answers.json next to them
//   holdout <purposes.json> <out.json>   write routing prompts for a skill list from one line of purpose per skill, without the skills' descriptions
// Flags: --model <name> (default muse-glimmer:latest), --host <url> (default http://127.0.0.1:11434), --seed <n>, --only <name,name> (holdout: just those skills)
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values, positionals } = parseArgs({ allowPositionals: true, options: { model: { type: 'string', default: 'muse-glimmer:latest' }, host: { type: 'string', default: 'http://127.0.0.1:11434' }, seed: { type: 'string', default: '1' }, only: { type: 'string' } } });
const [job, ...paths] = positionals;
const seed = Number(values.seed);

const chat = async (messages, format, options) => {
  const response = await fetch(`${values.host}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: values.model, stream: false, think: false, format, messages, options }) });
  if (!response.ok) throw new Error(`ollama answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const body = await response.json();
  return JSON.parse(body.message.content.replace(/<\|eot\|>$/, ''));
};

// The list is shuffled for each message, from the message's own id, so no skill gains from its place in the list.
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

async function answer(dir) {
  const prompts = JSON.parse(fs.readFileSync(path.join(dir, 'prompts.json'), 'utf8'));
  const skills = JSON.parse(fs.readFileSync(path.join(dir, 'skills.json'), 'utf8'));
  const format = { type: 'object', properties: { skill: { type: 'string', enum: [...skills.map((s) => s.name), 'none'] } }, required: ['skill'] };
  const answers = {};
  const started = Date.now();
  for (const prompt of prompts) {
    const listing = shuffled(skills, prompt.id).map((s) => `- ${s.name}: ${s.description}`).join('\n');
    const system = `You are the skill router of a coding agent. These skills are installed. You see only their names and descriptions.\n\n${listing}\n\nA user sends a message. Reply with the name of the one skill the agent should load to handle it, or "none" when no listed skill fits.`;
    const result = await chat([{ role: 'system', content: system }, { role: 'user', content: prompt.text }], format, { temperature: 0, seed });
    answers[prompt.id] = result.skill;
  }
  fs.writeFileSync(path.join(dir, 'answers.json'), `${JSON.stringify(answers, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, 'answers-meta.json'), `${JSON.stringify({ runner: 'evals/runners/ollama.mjs', model: values.model, seed, temperature: 0, shuffled: true, prompts: prompts.length, seconds: Math.round((Date.now() - started) / 1000), at: new Date().toISOString() }, null, 2)}\n`);
  console.log(`${prompts.length} answers from ${values.model} in ${Math.round((Date.now() - started) / 1000)} s, written to ${path.join(dir, 'answers.json')}`);
}

async function holdout(purposesFile, outFile) {
  const purposes = JSON.parse(fs.readFileSync(purposesFile, 'utf8'));
  const names = Object.keys(purposes.skills);
  const listing = Object.entries(purposes.skills).map(([name, purpose]) => `- ${name}: ${purpose}`).join('\n');
  const message = { type: 'object', properties: { text: { type: 'string' }, belongs_to: { type: 'string', enum: [...names, 'none'] } }, required: ['text', 'belongs_to'] };
  const format = { type: 'object', properties: { messages: { type: 'array', items: message } }, required: ['messages'] };
  const out = [];
  const jobs = [...Object.keys(purposes.skills).map((name) => ({ name, should: purposes.near.includes(name) ? 3 : 1, near: purposes.near.includes(name) ? 2 : 0 })), { name: 'none', should: 0, near: 0, none: purposes.none }];
  const only = values.only?.split(',');
  for (const job of jobs.filter((entry) => !only || only.includes(entry.name))) {
    const wantMessages = job.name === 'none'
      ? `Write ${job.none} messages a person might send to a coding agent that need NONE of the listed skills: plain coding questions, small fixes, general knowledge. Set belongs_to to "none" for each.`
      : `Write ${job.should} messages that clearly need the skill "${job.name}"${job.near ? `, and ${job.near} messages that sound similar to "${job.name}" but really need a different listed skill or none (set belongs_to to that skill, never "${job.name}")` : ''}. For the first ${job.should} set belongs_to to "${job.name}".`;
    const system = `You write test messages for a skill router. The skills are:\n${listing}\n\nWrite messages the way real people type to a coding agent: some short and lowercase, some with a sentence of context, some a little vague. Do not copy the purpose text. Each message stands alone. Reply with JSON.`;
    const result = await chat([{ role: 'system', content: system }, { role: 'user', content: wantMessages }], format, { temperature: 0.8, seed });
    out.push(...result.messages.map((m, index) => ({ skill: job.name, text: String(m.text).trim(), belongs_to: m.belongs_to, asShould: job.name !== 'none' && index < job.should })));
  }
  fs.writeFileSync(outFile, `${JSON.stringify({ model: values.model, seed, at: new Date().toISOString(), generated: out }, null, 2)}\n`);
  console.log(`${out.length} messages written to ${outFile}`);
}

if (job === 'answer' && paths[0]) await answer(paths[0]);
else if (job === 'holdout' && paths.length === 2) await holdout(paths[0], paths[1]);
else {
  console.error('usage: ollama.mjs answer <dir> | ollama.mjs holdout <purposes.json> <out.json>  [--model <name>] [--host <url>] [--seed <n>]');
  process.exitCode = 2;
}
