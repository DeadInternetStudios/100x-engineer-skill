import fs from 'node:fs';
import path from 'node:path';
import { load } from './config.mjs';
import { CliError } from './errors.mjs';
import { plural } from './eval/words.mjs';

// What the helpers of one run cost. `100x helper run` writes a line to .100x/helpers.jsonl for each helper that ends, with the tokens and seconds the SDK reported,
// so `100x status` can say the total and `budget.tokens` can stop a run the way the clock does. A helper started outside a project leaves no line, because there is no run to add it to.
const ledger = (root) => path.join(root, '.100x', 'helpers.jsonl');

export function recordHelper(root, { model, status, seconds, tokens, agentId }) {
  fs.mkdirSync(path.join(root, '.100x'), { recursive: true });
  const row = { at: new Date().toISOString(), model: model ?? null, status, seconds: seconds ?? null, tokens: Number.isFinite(tokens) ? tokens : null, agentId: agentId ?? null };
  fs.appendFileSync(ledger(root), `${JSON.stringify(row)}\n`);
}

function rows(root) {
  let text;
  try {
    text = fs.readFileSync(ledger(root), 'utf8');
  } catch {
    return [];
  }
  return text.split('\n').flatMap((line) => {
    try {
      return line.trim() ? [JSON.parse(line)] : [];
    } catch {
      return [];
    }
  });
}

// Totals over every helper the run has started. A helper whose result carried no token count is counted apart, so a total is never read as complete when it is not.
export function spent(root) {
  const all = rows(root);
  return {
    runs: all.length,
    tokens: all.reduce((sum, row) => sum + (row.tokens ?? 0), 0),
    seconds: all.reduce((sum, row) => sum + (row.seconds ?? 0), 0),
    unreported: all.filter((row) => row.tokens === null).length,
  };
}

// The helpers started since `sinceMs`. A row with no readable time counts, so a damaged line never hides a helper.
export const helperRunsSince = (root, sinceMs) => rows(root).filter((row) => !Number.isFinite(Date.parse(row.at)) || Date.parse(row.at) >= sinceMs).length;

export const budgetOf = (root) => load({ cwd: root }).effective.budget.tokens;

const count = (tokens) => (tokens >= 1e6 ? `${(tokens / 1e6).toFixed(1)}M` : tokens.toLocaleString('en-US'));
const time = (seconds) => (seconds < 5400 ? plural(Math.round(seconds / 60), 'minute') : `${(seconds / 3600).toFixed(1)} hours`);

// One line for `status` and for the end of a helper run. Empty when no helper has run and no cap is set.
export function spendLine(root) {
  const total = spent(root);
  const cap = budgetOf(root);
  if (!total.runs && cap === null) return null;
  const unreported = total.unreported ? `, and ${plural(total.unreported, 'helper')} reported no token count, so the total is a floor` : '';
  const left = cap === null ? '' : ` Cap ${count(cap)} tokens (budget.tokens), ${total.tokens >= cap ? 'spent' : `${count(cap - total.tokens)} left`}.`;
  return `${plural(total.runs, 'helper run')}, ${count(total.tokens)} tokens, ${time(total.seconds)} of helper time${unreported}.${left}`;
}

// Checked before a helper starts. A cap is a stop, as the clock is, and it is lifted by raising the setting.
export function refuseWhenSpent(root) {
  const cap = budgetOf(root);
  if (cap === null) return;
  const total = spent(root);
  if (total.tokens >= cap) throw new CliError(`The budget is spent: this run's helpers have used ${total.tokens.toLocaleString('en-US')} tokens and budget.tokens is ${cap.toLocaleString('en-US')}. No helper starts. Raise it with \`100x config set budget.tokens <number> --local\`, or take the cap off with \`100x config unset budget.tokens --local\`.`);
}
