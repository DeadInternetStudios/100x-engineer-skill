import { RULE_BY_ID } from './rules/index.mjs';
import { SLOP_BANDS, CLARITY_BANDS, EVEN_BELOW, BURSTINESS_MIN_SENTENCES } from './lint.mjs';
import { counted } from './counted.mjs';


// What the two scores count, in the words of the bands, for the first report a person reads.
const limits = (bands) => bands.map(([limit, name], i) => (i === bands.length - 1 ? `${name} above` : `${name} to ${limit}`)).join(', ');
const SCORE_GLOSS = [`  slop: stock phrases and padding per 1,000 words (${limits(SLOP_BANDS)})`, `  clarity: hard-to-read patterns per 1,000 words (${limits(CLARITY_BANDS)})`];
const BURSTINESS_GLOSS = `  burstiness: how much sentence length varies. Under ${EVEN_BELOW} is even, and it is judged from ${BURSTINESS_MIN_SENTENCES} sentences`;
const LINT_GLOSS = [...SCORE_GLOSS, BURSTINESS_GLOSS, '  grade: the US school grade it takes to read this. ease: 0 to 100, higher is easier'];
const CHECK_GLOSS = [...SCORE_GLOSS, BURSTINESS_GLOSS];

// One line quoted once, with every rule that hit it and the words that matched: five stock words in
// one sentence are one finding to read, not five copies of the sentence.
function groupFindings(findings) {
  const groups = new Map();
  for (const finding of findings) {
    const quote = finding.shown ?? finding.quote;
    const where = finding.key ? `${finding.key} (line ${finding.line})` : `line ${finding.line}`;
    const id = `${where}\n${quote}`;
    if (!groups.has(id)) groups.set(id, { where, quote, rules: new Map() });
    const rules = groups.get(id).rules;
    if (!rules.has(finding.rule)) rules.set(finding.rule, { matches: new Set(), notes: new Set() });
    const entry = rules.get(finding.rule);
    if (finding.match && finding.match.length < 60) entry.matches.add(finding.match);
    if (finding.note) entry.notes.add(finding.note);
  }
  const said = (rule, { matches, notes }) => `${rule}${notes.size ? ` [${[...notes].join('; ')}]` : ''}${matches.size ? ` (${[...matches].join(', ')})` : ''}`;
  return [...groups.values()].map(({ where, quote, rules }) => ({ where, quote, parts: [...rules].map(([rule, entry]) => said(rule, entry)) }));
}

export function formatLint(report, { max = 25, gloss = false } = {}) {
  const { metrics, scores, profile, level, file, format } = report;
  const lines = [];
  const label = file ?? '(stdin)';
  const inferred = report.profileInferred ? ' (inferred)' : '';
  lines.push(`${label}  [${profile}${inferred} · ${level} · ${format}]`);
  if (report.leftOut) {
    const left = `${report.leftOut} ${format === 'prose' ? 'block' : 'string'}${report.leftOut === 1 ? '' : 's'}`;
    const mostly = report.english ? '' : ' Most of this text is in that script, so the scores say little.';
    lines.push(`  NOTE  ${left} in another script (Chinese, Russian, Arabic and so on) ${report.leftOut === 1 ? 'is' : 'are'} not scored, because the rules are patterns for English.${mostly}`);
  } else if (report.sourceKind) {
    const what = report.sourceKind === 'markup' ? 'HTML or other markup' : 'source code';
    const words = report.sourceKind === 'markup' ? 'the words the page shows' : 'the strings a person reads';
    lines.push(`  NOTE  this is ${what}, not text a person reads, and its tags and names count as words, so the scores say little. Lint ${words} instead: put them in a text file, one per line.`);
  } else if (!report.english) {
    lines.push('  NOTE  the text does not look English (Spanish, German and so on), and the rules are patterns for English, so the scores say little. Grade and ease are not shown.');
  }
  if (report.guessedUi) lines.push(`  NOTE  profile guessed: ui, because no line has more than ${counted(report.guessedUi.longest, 'word')}. If this is prose, run the same command with --profile docs.`);
  if (!metrics.words) {
    lines.push('  No text to score: the input has no words.');
    return lines.join('\n');
  }
  const { slopBand, clarityBand } = scores;
  lines.push(`  slop ${scores.slop}/1k words ${slopBand}   clarity ${scores.clarity}/1k ${clarityBand}   ${counted(metrics.words, 'word')}, ${counted(metrics.sentences, 'sentence')}`);
  if (gloss) lines.push(...LINT_GLOSS);
  lines.push(`  sentence length mean ${metrics.meanSentence}, spread ${metrics.stdevSentence}, burstiness ${metrics.burstiness}   grade ${metrics.grade ?? '–'}, ease ${metrics.ease ?? '–'}`);

  // A finding on text that is not English would be an English rule applied to another language, so none is listed.
  if (!report.english) {
    if (report.findings.length) lines.push(`  ${report.findings.length} possible ${report.findings.length === 1 ? 'finding' : 'findings'} not listed: the rules are patterns for English. "--json" still has them.`);
    return lines.join('\n');
  }

  if (report.byRule.length) {
    const summary = report.byRule.slice(0, 8).map((r) => `${r.rule} ×${r.count}`).join(', ');
    lines.push(`  top rules: ${summary}`);
  }

  const ranked = [...report.findings].sort((a, b) => b.weight - a.weight || a.line - b.line);
  const shown = max > 0 ? ranked.slice(0, max) : ranked;
  shown.sort((a, b) => a.line - b.line);
  for (const { where, quote, parts } of groupFindings(shown)) {
    lines.push(`  ${where}  ${parts.join('; ')}`);
    lines.push(`      "${quote}"`);
  }
  if (shown.length < ranked.length) lines.push(`  … ${ranked.length - shown.length} more findings (use --max 0 to list all)`);
  const hints = new Set(shown.map((f) => f.rule));
  if (hints.size) {
    lines.push('  fixes:');
    for (const id of hints) lines.push(`    ${id}: ${RULE_BY_ID.get(id).fix}`);
  }
  return lines.join('\n');
}

export function formatSummaryTable(reports) {
  const rows = reports.map((r) => [
    r.file ?? '(stdin)',
    r.profile,
    String(r.metrics.words),
    String(r.scores.slop),
    r.scores.slopBand,
    String(r.scores.clarity),
    r.scores.clarityBand,
  ]);
  const header = ['file', 'profile', 'words', 'slop', 'band', 'clarity', 'band'];
  const all = [header, ...rows];
  const widths = header.map((_, i) => Math.max(...all.map((row) => row[i].length)));
  return all.map((row) => row.map((cell, i) => cell.padEnd(widths[i])).join('  ').trimEnd()).join('\n');
}

const ARROW = '→';
// Chunks are for texts too long to rewrite in one pass. Below this a table of one row says nothing.
const TOO_SHORT_TO_SPLIT = 50;

function change(before, after) {
  const pct = before ? Math.round(((after - before) / before) * 100) : 0;
  return `${before} ${ARROW} ${after} (${pct > 0 ? '+' : ''}${pct}%)`;
}

const plural = (n, word) => `${n} ${word}`;

function formatChanges(changes) {
  if (!changes) return [];
  const lines = [];
  const { sentences, strings, tells, facts } = changes;
  if (sentences) {
    const parts = [['kept', sentences.kept], ['reworded', sentences.reworded], ['split', sentences.split], ['joined', sentences.merged], ['replaced', sentences.replaced], ['cut', sentences.cut], ['added', sentences.added], ['short or split-off', sentences.extra]]
      .filter(([, n]) => n > 0)
      .map(([label, n]) => plural(n, label));
    lines.push(`  prose sentences ${sentences.before} ${ARROW} ${sentences.after}: ${parts.join(', ') || 'none changed'}`);
  }
  if (strings && (strings.shorter || strings.longer)) {
    lines.push(`  strings: ${strings.shorter} shorter, ${strings.longer} longer, ${strings.changed - strings.shorter - strings.longer} the same length`);
  }
  const rules = (items) => items.slice(0, 4).map((entry) => `${entry.rule} ${entry.before} ${ARROW} ${entry.after}`).join(', ') + (items.length > 4 ? `, +${items.length - 4} more` : '');
  if (tells?.removed.length) lines.push(`  tells removed: ${rules(tells.removed)}`);
  if (tells?.added.length) lines.push(`  tells added: ${rules(tells.added)}`);
  if (facts?.length) lines.push(`  facts kept: ${facts.map((fact) => `${fact.label} ${fact.kept} of ${fact.total}`).join(', ')}`);
  return lines;
}

export const shellWord = (path) => (/^[\w@%+=:,./-]+$/.test(path) ? path : `'${path.replace(/'/g, `'\\''`)}'`);

export function formatCheck(result, { before, after, max = 12, strict = false, program, gloss = false } = {}) {
  const lines = [];
  const head = before && after ? `${before} ${ARROW} ${after}` : '(rewrite)';
  lines.push(`${head}  [${result.profile} · ${result.level} · ${result.format}]`);
  const verdict = !result.ok ? 'FAIL' : !result.warnings.length ? 'PASS' : strict ? 'FAIL under --strict' : 'PASS with warnings';
  lines.push(`  ${verdict}: ${counted(result.errors.length, 'error')}, ${counted(result.warnings.length, 'warning')}`);
  if (result.identical) {
    lines.push('  The two files are identical.');
    return lines.join('\n');
  }
  const { stats } = result;
  if (stats) {
    lines.push(`  slop ${stats.slop.before} ${ARROW} ${stats.slop.after} (${stats.slop.beforeBand} ${ARROW} ${stats.slop.afterBand})   clarity ${stats.clarity.before} ${ARROW} ${stats.clarity.after} (${stats.clarity.beforeBand} ${ARROW} ${stats.clarity.afterBand})`);
    const { burstiness } = stats;
    const even = burstiness.beforeBand && burstiness.afterBand ? ` (${burstiness.beforeBand} ${ARROW} ${burstiness.afterBand})` : '';
    lines.push(`  words ${change(stats.words.before, stats.words.after)}   burstiness ${burstiness.before} ${ARROW} ${burstiness.after}${even}`);
    if (stats.strings) lines.push(`  strings: ${stats.strings.changed} of ${stats.strings.total} changed`);
    lines.push(...formatChanges(stats.changes));
  }
  const section = (label, items) => {
    if (!items.length) return;
    const groups = new Map();
    for (const item of items) groups.set(item.code, [...(groups.get(item.code) ?? []), item]);
    for (const [code, group] of groups) {
      const shown = max > 0 ? group.slice(0, Math.min(max, 3)) : group;
      for (const item of shown) lines.push(`  ${label} ${code}: ${item.message}`);
      if (group.length > shown.length) lines.push(`  ${label} ${code}: … ${group.length - shown.length} more${max > 0 ? ' (use --max 0 to list all)' : ''}`);
    }
  };
  section('ERROR', result.errors);
  section('WARN ', result.warnings);
  if (!result.english) lines.push('  NOTE  the text does not look English, so the negation, hedge and absolute-word checks were skipped. Compare the meaning yourself.');
  if (gloss && stats) lines.push(...CHECK_GLOSS);
  const moved = stats?.changes?.sentences;
  if (program && moved && before !== '-' && after !== '-' && moved.before - moved.kept + moved.added > 0) lines.push(`  see each changed sentence: ${program} diff ${shellWord(before)} ${shellWord(after)}`);
  return lines.join('\n');
}

function table(rows) {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((row) => String(row[i]).length)));
  return rows.map((row) => row.map((cell, i) => String(cell).padEnd(widths[i])).join('  ').trimEnd());
}

export function formatAudit(report, { file } = {}) {
  const lines = [`${file ?? '(stdin)'}  ${report.prose ? `${counted(report.strings, 'paragraph')}, read as prose` : counted(report.strings, 'string')}`];
  if (!report.strings) return `${lines[0]}\n  Nothing to audit: the input has no strings.`;
  if (report.labels) {
    const show = (counts) => Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';
    // A group with no strings in it has nothing to say.
    if (report.labels.count) lines.push(`  labels (${report.labels.count}): case ${show(report.labels.capitalization)}; endings ${show(report.labels.endings)}`);
    if (report.messages.count) lines.push(`  messages (${report.messages.count}): endings ${show(report.messages.endings)}`);
  }
  if (!report.findings.length) lines.push(report.prose ? '  No wording problems found. Text read as prose is checked for terms only: capitalization, endings and voice need a file of strings.' : '  No consistency problems found.');
  for (const finding of report.findings) {
    lines.push(`  - ${finding.title}`);
    lines.push(`      ${finding.advice}`);
    for (const example of finding.examples) lines.push(`      ${example.key}: "${example.value.replace(/\s+/g, ' ').trim()}"`);
  }
  return lines.join('\n');
}

export function formatPlan(plan, { file } = {}) {
  const inferred = plan.profileInferred ? ' (inferred)' : '';
  const lines = [
    `${file ?? '(stdin)'}  [${plan.profile}${inferred} · ${plan.level}]  ${counted(plan.words, 'word')}, ${counted(plan.sentences, 'sentence')}`,
    `  slop ${plan.slop}/1k ${plan.slopBand}   clarity ${plan.clarity}/1k ${plan.clarityBand}`,
    '',
  ];
  if (!plan.words) return `${lines[0]}\n  No text to split: the input has no words.`;
  if (plan.words < TOO_SHORT_TO_SPLIT) return `${lines[0]}\n  Too short to split: under ${TOO_SHORT_TO_SPLIT} words is one chunk. "lint" scores it whole.`;
  const rows = [['chunk', 'lines', 'words', 'slop', 'clarity', 'section']];
  for (const chunk of plan.chunks) {
    rows.push([String(chunk.id), `${chunk.startLine}-${chunk.endLine}`, String(chunk.words), `${chunk.slop} ${chunk.slopBand}`, `${chunk.clarity} ${chunk.clarityBand}`, chunk.heading.split(' > ').pop().slice(0, 60)]);
  }
  lines.push(...table(rows).map((row) => `  ${row}`));
  return lines.join('\n');
}

export function formatBegin(result) {
  const rows = [['file', 'profile', 'words', 'slop', 'clarity']];
  const sorted = [...result.files].sort((a, b) => b.slop - a.slop);
  for (const f of sorted) rows.push([f.path, f.profile, String(f.words), `${f.slop} ${f.slopBand}`, `${f.clarity} ${f.clarityBand}`]);
  return [`Saved ${counted(result.files.length, 'original')} in ${result.root} (worst first):`, ...table(rows).map((row) => `  ${row}`)].join('\n');
}

// The saved originals stay until the person removes them, and the tool never deletes them.
export const snapshotKept = (name) => `The originals stay in .unslop/${name} (git ignores that folder). Delete it to close the snapshot.`;

export function formatFinish(report, { max = 5, strict = false } = {}) {
  const rows = [['file', 'status', 'slop', 'words', 'errors', 'warnings']];
  for (const r of report.results) {
    const slop = r.stats ? `${r.stats.slop.before} ${ARROW} ${r.stats.slop.after}` : '-';
    const words = r.stats ? change(r.stats.words.before, r.stats.words.after) : '-';
    rows.push([r.path, r.status, slop, words, String(r.errors.length), String(r.warnings.length)]);
  }
  const lines = [`Snapshot "${report.name}"`, ...table(rows).map((row) => `  ${row}`)];
  for (const r of report.results) {
    if (!r.errors.length && !(r.status === 'WARN' && max > 0)) continue;
    lines.push('', `${r.path}`);
    for (const item of r.errors.slice(0, max || undefined)) lines.push(`  ERROR ${item.code}: ${item.message}`);
    if (max > 0 && r.errors.length > max) lines.push(`  ERROR … ${r.errors.length - max} more`);
    for (const item of r.warnings.slice(0, max || undefined)) lines.push(`  WARN  ${item.code}: ${item.message}`);
    if (max > 0 && r.warnings.length > max) lines.push(`  WARN  … ${r.warnings.length - max} more`);
  }
  const warned = report.results.filter((r) => r.status === 'WARN').length;
  const failed = report.results.some((r) => r.status === 'FAIL' || r.status === 'MISSING');
  if (strict && warned) lines.push('', `FAIL under --strict: ${warned} ${warned === 1 ? 'file has' : 'files have'} warnings`);
  else if (!failed) lines.push('', `Done. ${snapshotKept(report.name)} "unslop restore all" puts the originals back.`);
  return lines.join('\n');
}
