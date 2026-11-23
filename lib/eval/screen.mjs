import { pairWords, standing } from './tally.mjs';
import { duration, plural, shellPath, wrap } from './words.mjs';

// What a person reads in the terminal after `score`: the counts, the verdict, one line for each reason, and where the whole report is.
// report.md keeps the same facts in the order a file wants them, with the interval, the models and the limits.
export function bakeoffScreen(r, { dir, written, asked = false, closing = null }) {
  const bullets = (reasons) => reasons.map((reason) => `  - ${wrap(`${reason}.`, { width: 96, indent: '    ' })}`);
  const now = standing(r);
  const lines = [`Bake-off in ${dir}`, now.counts, `Verdict: ${now.verdict.text}`, ...bullets(now.verdict.bullets)];
  if (now.cautions.length) lines.push('Caution:', ...bullets(now.cautions));
  lines.push('');
  if (r.pairs.length) {
    const width = Math.max(...r.pairs.map((pair) => pair.id.length));
    for (const pair of r.pairs) lines.push(`${pair.id.padEnd(width)}  ${pair.brief}: ${pairWords(pair)}`);
  } else lines.push('No pair has both its verdicts yet.');
  if (r.missing.length) lines.push(`Next: judge ${r.missing.slice(0, 3).join(', ')}${r.missing.length > 3 ? `, and ${plural(r.missing.length - 3, 'more folder')}` : ''}. \`100x eval bakeoff status ${shellPath(dir)}\` lists them all and the command for each.`);
  if (r.controls.length) lines.push(r.judgeTrusted ? 'Controls: the judge passed both.' : `Controls: ${r.controls.some((c) => !c.pass) ? 'the judge failed one' : 'one is missing'}, so the judge is not trusted.`);

  const [a, b] = r.arms.map((arm) => r.minutes[arm].median);
  if (a !== null && b !== null) lines.push(`Median time: ${r.arms[0]} ${duration(a)}, ${r.arms[1]} ${duration(b)}.`);
  lines.push('', closing ?? (written ? `The whole report, with the interval, the models and the limits: ${written}` : asked ? 'Nothing was written, as --no-write asked. Run score without it to get report.md.' : 'The whole report could not be written here. Run score in a folder you can write to.'));
  return `${lines.join('\n')}\n`;
}
