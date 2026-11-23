import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCompanion } from './companions.mjs';
import { modern } from './runfile.mjs';

const SHOWN = 5;

// The words the owner reads first, one entry each: the pitch, the moment, why the verdict, the first steps and the next asks.
// `key` is what `100x run set` takes to write that one again.
export function factLines(run) {
  run = modern(run) ?? {};
  const list = (name) => (Array.isArray(run[name]) ? run[name] : []).map((text, index) => ({ key: `${name}.${index}`, name: `${name === 'tryFirst' ? 'try-first step' : 'next ask'} ${index + 1}`, text }));
  return [
    { key: 'pitch', name: 'the pitch', text: run.pitch },
    { key: 'moment', name: 'the moment', text: run.moment },
    { key: 'verdictWhy', name: 'the reason for the verdict', text: run.verdictWhy },
    ...list('tryFirst'),
    ...list('nextAsks'),
  ]
    .map((fact) => ({ ...fact, text: String(fact.text ?? '').replace(/\s+/g, ' ').trim() }))
    .filter((fact) => fact.text);
}

// The facts go through the writing tool, so a padded pitch is named where it is written and not on the owner's phone.
// A finding is a warning, and a tool that is missing or fails says nothing: this never blocks a finish.
export function paddedFacts(run) {
  const facts = factLines(run);
  if (!facts.length) return [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), '100x-facts-'));
  try {
    const file = path.join(dir, 'facts.txt');
    // A blank line between facts makes each its own paragraph, so a finding on line 2n+1 belongs to fact n.
    fs.writeFileSync(file, `${facts.map((fact) => fact.text).join('\n\n')}\n`);
    const result = runCompanion('unslop-text', ['lint', file, '--profile', 'message', '--json'], { stdio: 'pipe' });
    const found = (JSON.parse(result.stdout).findings ?? []).filter((finding) => finding.kind === 'slop');
    if (!found.length) return [];
    const hits = found.map((finding) => ({ fact: facts[Math.floor((finding.line - 1) / 2)], said: finding.match ?? finding.rule })).filter((hit) => hit.fact);
    if (!hits.length) return [];
    const shown = hits.slice(0, SHOWN).map(({ fact, said }) => `"${said}" in ${fact.name}`);
    const more = hits.length > SHOWN ? `, and ${hits.length - SHOWN} more` : '';
    return [`the words the owner reads first have stock phrases: ${shown.join(', ')}${more}. Say each one plainly, for example \`100x run set ${hits[0].fact.key} "<plainer>"\`. \`100x text lint <file> --profile message\` explains each rule`];
  } catch {
    return [];
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
