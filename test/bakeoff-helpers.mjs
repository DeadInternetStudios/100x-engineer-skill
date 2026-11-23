import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { markRun } from '../lib/eval/blind.mjs';
import { sealFile } from '../lib/seal.mjs';
import { cli, write } from './helpers.mjs';

export const OFF = 'skill-off';
export const ON = 'skill-on';
export const ARMS = [OFF, ON];
export const ORDERS = ['o1', 'o2'];
// Each arm works in a folder named by its place in the arms list, so the folder name says nothing about the arm.
export const folder = (dir, brief, arm) => path.join(dir, 'arms', brief, arm === OFF ? 'arm-1' : 'arm-2');
export const page = (brief, arm) => `<!doctype html><html><head><title>Page ${brief}</title></head><body><h1>Page ${brief}, version ${arm === OFF ? 'one' : 'two'}</h1></body></html>\n`;

// A receipt the way `100x helper run --receipt` writes it: what the SDK reported, signed with this process's 100x key.
export function makeReceipt(file, { ran = 'test-model', requested = ran, params = { reasoning_effort: 'max', context: '300k' }, runId = `run-${path.basename(file, '.json')}`, tokens = 1000 } = {}) {
  const ids = Object.entries(params).map(([id, value]) => ({ id, value }));
  write(file, `${JSON.stringify({ version: 1, at: '2026-11-20T10:00:00Z', status: 'finished', requested: { id: requested, params: ids }, ran: { id: ran, params: ids }, modelCheck: ran === requested ? 'same' : 'mismatch', differences: [], seconds: 60, tokens, agentId: `agent-${runId}`, runId, sdkVersion: '1.4.2' }, null, 2)}\n`);
  sealFile(file);
  return file;
}

// The score withholds the word unless the model that ran is on record for every arm run and every judge folder, and says "ahead" only when a receipt backs each record.
// So a bake-off made for a score test has a receipt for each, unless `typed` asks for names typed by hand.
export function recordModels(dir, briefs, { model = 'test-model', judgeModel = 'test-judge-model', typed = false, params } = {}) {
  const start = new Date('2026-11-20T10:00:00Z');
  const receipts = path.join(path.dirname(dir), `receipts-${path.basename(dir)}`);
  const receiptFor = (name) => makeReceipt(path.join(receipts, `${name.replaceAll('/', '__')}.json`), { ran: model, params });
  for (const brief of briefs) {
    for (const arm of ARMS) {
      const key = `${brief.id}/${arm}`;
      markRun(dir, { key, action: 'start', now: start, ...(typed ? { model, source: 'sdk' } : {}) });
      markRun(dir, { key, action: 'stop', now: new Date(start.getTime() + 10 * 60_000), ...(typed ? { ran: model } : { receipt: receiptFor(key) }) });
    }
  }
  if (typed) markRun(dir, { key: 'judge', action: 'stop', model: judgeModel, ran: judgeModel, source: 'sdk' });
  else markRun(dir, { key: 'judge', action: 'stop', receipt: makeReceipt(path.join(receipts, 'judge.json'), { ran: judgeModel, params }) });
}

// A bake-off folder with `n` briefs, the arms' pages written, and the pairs built. The pages say nothing about which arm made them.
// The models are on record unless `record` is false, because the tests of the record mark them by hand.
export function bakeoff(box, { n = 6, seed = 11, pairs = true, record = pairs, where = path.join(box.dir, 'bake') } = {}) {
  const dir = where;
  // Some tests score in this process, and the seal is signed with the key in the global folder, so this process must read the box's folder and not the real one.
  process.env.X100_HOME = box.env.X100_HOME;
  const briefs = Array.from({ length: n }, (_, i) => ({ id: `brief-${i + 1}`, title: `Brief ${i + 1}`, text: `Make page number ${i + 1}.` }));
  write(path.join(box.dir, 'briefs.json'), JSON.stringify(briefs));
  const init = cli(['eval', 'bakeoff', 'init', dir, '--briefs', path.join(box.dir, 'briefs.json'), '--seed', String(seed)], { cwd: box.project, env: box.env });
  assert.equal(init.code, 0, init.err);
  for (const brief of briefs) {
    for (const arm of ARMS) {
      write(path.join(folder(dir, brief.id, arm), 'index.html'), page(brief.id, arm));
      write(path.join(folder(dir, brief.id, arm), 'RUN.md'), `Open index.html. Written by the ${arm} arm.\n`);
    }
  }
  if (pairs) {
    const built = cli(['eval', 'bakeoff', 'pairs', dir, '--no-capture'], { cwd: box.project, env: box.env });
    assert.equal(built.code, 0, built.err);
  }
  if (record) recordModels(dir, briefs);
  return { dir, briefs };
}

export const keyOf = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'key.json'), 'utf8'));
// What ask.md tells a judge to copy into its verdict: the start of the key's hash.
export const sealedOf = (dir) => fs.readFileSync(path.join(dir, 'key.sha256'), 'utf8').split(/\s+/)[0].slice(0, 16);

// A fake judge. `decide` gets the pair and which label sits in the A place, and answers A, B or tie. Only the tests read the key.
export function judge(dir, decide, { quote = true } = {}) {
  for (const item of keyOf(dir).items) {
    for (const order of ORDERS) {
      const sides = order === 'o1' ? { A: item.first, B: item.second } : { A: item.second, B: item.first };
      write(path.join(dir, 'judge', `${item.id}-${order}`, 'verdict.json'), JSON.stringify({ winner: decide({ item, order, sides }), why: 'because', ...(quote ? { sealed: sealedOf(dir) } : {}) }));
    }
  }
}

// A judge that can see: it picks the intact page of the planted control, calls the identical pair a tie, and prefers `favor(item)` on a real pair.
export const sees = (favor) => ({ item, sides }) => {
  if (item.kind === 'planted') return sides.A === 'intact' ? 'A' : 'B';
  if (item.kind === 'identical') return 'tie';
  return sides.A === favor(item) ? 'A' : 'B';
};
// The first `wins` briefs go to skill-on and the rest to skill-off.
export const split = (dir, wins) => {
  const real = keyOf(dir).items.filter((i) => i.kind === 'real').map((i) => i.brief).sort();
  const winners = new Map(real.map((brief, index) => [brief, index < wins ? ON : OFF]));
  return (item) => winners.get(item.brief);
};
