import { writeFileSync, readFileSync } from 'node:fs';
import { basename, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, collectFiles, readInput, readText, encodeText, pick, PROSE_EXTENSIONS } from './cli.mjs';
import { UsageError, inFile } from './errors.mjs';
import { lintSource } from './lint.mjs';
import { checkRewrite } from './check.mjs';
import { ledgerOf, formatLedger, compareSentences, formatCoverage } from './claims.mjs';
import { formatDiff, diffSentences } from './diff.mjs';
import { voiceSheet, formatVoiceSheet } from './voice-sheet.mjs';
import { auditEntries } from './audit.mjs';
import { planDocument } from './plan.mjs';
import { begin, finish, restore, SnapshotError } from './snapshot.mjs';
import { listStrings, applyEdits, stringsFormat } from './strings.mjs';
import { parseProse } from './blocks.mjs';
import { isProse } from './rules/helpers.mjs';
import { formatLint, formatSummaryTable, formatCheck, formatAudit, formatPlan, formatBegin, formatFinish, snapshotKept, shellWord } from './report.mjs';
import { PROFILE_NAMES, LEVEL_NAMES, PROFILES, inferProfile } from './profiles.mjs';
import { RULES } from './rules/index.mjs';
import { PLAIN_WORDS, WORDY_PHRASES, NOMINALIZATIONS, IDIOMS } from './vocab.mjs';
import { globalHelp, commandHelp } from './help.mjs';
import { counted } from './counted.mjs';

const FORMATS = ['auto', 'prose', 'lines', 'json', 'kv', 'csv', 'xml'];
const MARKUP_DOCUMENT = /\.(?:md|mdx|markdown|rst|adoc)$/i;
const STRING_FILES = 'json, properties, .strings, csv, tsv, Android strings.xml and one-string-per-line files';

function commonOptions(flags) {
  return {
    profile: pick(flags, 'profile', ['auto', ...PROFILE_NAMES], 'auto'),
    level: pick(flags, 'level', LEVEL_NAMES, 'standard'),
    format: pick(flags, 'format', FORMATS, 'auto'),
    allStrings: Boolean(flags['all-strings']),
    column: flags.column,
  };
}

function numberFlag(flags, name, fallback, { min = 0 } = {}) {
  if (flags[name] === undefined) return fallback;
  const value = Number(flags[name]);
  if (!Number.isFinite(value) || value < min) throw new UsageError(`--${name} must be a number of at least ${min}`);
  return value;
}

const noFiles = (paths) => new UsageError(`no text files found in ${paths.map((path) => `"${path}"`).join(', ')}. A folder search takes ${[...PROSE_EXTENSIONS].join(', ')} files. Name any other file, such as locales/en.json, by itself`);

function runLint({ positional, flags }) {
  if (!positional.length) throw new UsageError('lint needs a file, a directory or "-" for stdin');
  const options = commonOptions(flags);
  const max = numberFlag(flags, 'max', 25);
  // A bad limit is refused before any file is read, like every other number.
  if (flags['fail-above'] !== undefined) numberFlag(flags, 'fail-above', null);
  const files = positional.includes('-') ? ['-'] : collectFiles(positional);
  if (!files.length) throw noFiles(positional);
  const reports = files.map((file) => inFile(file === '-' ? 'stdin' : file, () => lintSource(readInput(file), { ...options, file: file === '-' ? undefined : file })));
  if (flags.json) {
    console.log(JSON.stringify(reports.length === 1 ? reports[0] : reports, null, 2));
  } else {
    if (flags.summary && reports.length < 2) throw new UsageError('--summary is for several files: it prints the table and leaves out each file\'s findings');
    if (reports.length > 1) console.log(`${formatSummaryTable(reports)}\n`);
    if (flags.summary) return exitFor(reports, flags);
    // Among several files, a file with nothing to say has its row in the table and no detail block. A run
    // that gates on a limit (`--fail-above`) lists only the files that broke it, unless `--full` asks for all.
    const limit = flags['fail-above'] === undefined || flags.full ? null : numberFlag(flags, 'fail-above', null);
    const worth = (report) => (limit === null ? report.findings.length || report.leftOut || !report.english : report.scores.slop > limit);
    const detailed = reports.length > 1 ? reports.filter(worth) : reports;
    detailed.forEach((report, i) => console.log(`${formatLint(report, { max, gloss: i === 0 })}\n`));
    const skipped = reports.length - detailed.length;
    if (skipped && limit === null) console.log(`${counted(skipped, 'file')} had no findings, and the scores are in the table above. Run lint on one file to see its detail.\n`);
    else if (skipped) console.log(`${counted(skipped, 'file')} within the limit of ${limit}, so their findings are not listed. Add --full to list them, or run lint on one file.\n`);
  }
  return exitFor(reports, flags);
}

function exitFor(reports, flags) {
  const limit = flags['fail-above'] === undefined ? null : numberFlag(flags, 'fail-above', null);
  return limit !== null && reports.some((r) => r.scores.slop > limit) ? 1 : 0;
}

function runCheck({ positional, flags }) {
  if (positional.length !== 2) throw new UsageError('check needs exactly two files: <before> <after>');
  const [beforePath, afterPath] = positional;
  const maxGrowth = numberFlag(flags, 'max-growth', undefined, { min: 0.01 });
  const file = beforePath === '-' ? afterPath : beforePath;
  const result = checkRewrite(readInput(beforePath), readInput(afterPath), { ...commonOptions(flags), file, maxGrowth });
  if (flags.json) console.log(JSON.stringify(result, null, 2));
  else console.log(formatCheck(result, { before: beforePath, after: afterPath, max: numberFlag(flags, 'max', 12), strict: Boolean(flags.strict), program: programName(), gloss: true }));
  if (!result.ok) return 1;
  return flags.strict && result.warnings.length ? 1 : 0;
}

// The lint findings for the original, so a cut stock phrase is marked as one.
const findingsOf = (source, file, flags) => lintSource(source, { profile: pick(flags, 'profile', ['auto', ...PROFILE_NAMES], 'auto'), file: file === '-' ? undefined : file }).findings;

function runClaims({ positional, flags }) {
  if (positional.length < 1 || positional.length > 2) throw new UsageError('claims needs one file for a checklist, or two files (<before> <after>) for what was cut or added');
  const [beforePath, afterPath] = positional;
  const file = beforePath === '-' ? afterPath : beforePath;
  const before = readInput(beforePath);
  if (!afterPath) {
    if (flags.profile !== undefined) throw new UsageError('claims takes --profile only with two files, where it marks the stock phrases that were cut');
    const entries = ledgerOf(before, file);
    console.log(flags.json ? JSON.stringify(entries, null, 2) : formatLedger(entries, { file: beforePath }));
    return 0;
  }
  const report = compareSentences(before, readInput(afterPath), file, { findings: findingsOf(before, file, flags) });
  console.log(flags.json ? JSON.stringify({ counts: report.alignment.counts, cut: report.cut, replaced: report.replaced, added: report.added }, null, 2) : formatCoverage(report, { before: beforePath, after: afterPath }));
  return 0;
}

function runDiff({ positional, flags }) {
  if (positional.length !== 2) throw new UsageError('diff needs two files: <before> <after>');
  const [beforePath, afterPath] = positional;
  const file = beforePath === '-' ? afterPath : beforePath;
  const before = readInput(beforePath);
  const report = compareSentences(before, readInput(afterPath), file, { findings: findingsOf(before, file, flags) });
  console.log(flags.json ? JSON.stringify({ counts: report.alignment.counts, changes: diffSentences(report) }, null, 2) : formatDiff(report, { before: beforePath, after: afterPath }));
  return 0;
}

// What a text sounds like is in its words, not in the braces and keys around them. A strings file is read
// as its string values, each one a sentence.
function voiceText(path) {
  const source = readInput(path);
  const format = stringsFormat(path, 'auto', source);
  if (format === 'lines' || format === 'prose') return source;
  const { editable } = inFile(path, () => listStrings(source, format, {}));
  return editable.map((entry) => entry.value.trim()).filter(Boolean).map((text) => (/[.!?…]["')\]]*$/.test(text) ? text : `${text}.`)).join('\n');
}

function runVoice({ positional, flags }) {
  if (positional.length < 1 || positional.length > 2) throw new UsageError('voice needs one file, or two files (<before> <after>) to compare how they sound');
  const [beforePath, afterPath] = positional;
  const sheets = positional.map((path) => voiceSheet(voiceText(path), path));
  if (flags.json) console.log(JSON.stringify(afterPath ? { before: sheets[0], after: sheets[1] } : sheets[0], null, 2));
  else console.log(formatVoiceSheet(sheets[0], { file: beforePath, after: sheets[1], afterFile: afterPath }));
  return 0;
}

function runBegin({ positional, flags }) {
  if (!positional.length) throw new UsageError('begin needs at least one file or directory');
  const files = collectFiles(positional);
  if (!files.length) throw noFiles(positional);
  const options = commonOptions(flags);
  const result = begin(files, { name: flags.name ?? 'main', force: Boolean(flags.force), options });
  if (flags.json) console.log(JSON.stringify(result, null, 2));
  else console.log(formatBegin(result));
  return 0;
}

function runFinish({ flags }) {
  const given = commonOptions(flags);
  const overrides = { level: given.level, allStrings: given.allStrings };
  if (given.profile !== 'auto') overrides.profile = given.profile;
  if (given.format !== 'auto') overrides.format = given.format;
  if (given.column !== undefined) overrides.column = given.column;
  const report = finish({ name: flags.name ?? 'main', allowOutside: Boolean(flags['allow-outside']), options: overrides });
  if (flags.json) console.log(JSON.stringify(report, null, 2));
  else console.log(formatFinish(report, { max: numberFlag(flags, 'max', 5), strict: Boolean(flags.strict) }));
  const failed = report.results.some((r) => r.status === 'FAIL' || r.status === 'MISSING');
  const warned = report.results.some((r) => r.status === 'WARN');
  return failed || (flags.strict && warned) ? 1 : 0;
}

function runRestore({ positional, flags }) {
  if (positional.length !== 1) throw new UsageError('restore needs one file, or "all"');
  const restored = restore(positional[0], { name: flags.name ?? 'main', allowOutside: Boolean(flags['allow-outside']) });
  if (flags.json) console.log(JSON.stringify({ restored }, null, 2));
  else {
    for (const path of restored) console.log(`restored ${path}`);
    console.log(snapshotKept(flags.name ?? 'main'));
  }
  return 0;
}

function runStrings({ positional, flags }) {
  if (positional.length !== 1) throw new UsageError('strings needs one file');
  const [file] = positional;
  const { total, editable, note } = inFile(file, () => {
    const source = readInput(file);
    const format = stringsFormat(file, flags.format, source);
    if (format === 'prose') throw new UsageError(`strings works on ${STRING_FILES}. Use --format lines for a text list`);
    if (format === 'lines' && !flags.format && MARKUP_DOCUMENT.test(file)) throw new UsageError(`${file} is a document, not a set of strings. Use "lint" or "check" for prose, or add --format lines to treat each line as a string`);
    return listStrings(source, format, { allStrings: Boolean(flags['all-strings']), column: flags.column });
  });
  const offset = numberFlag(flags, 'offset', 0);
  const limit = numberFlag(flags, 'limit', editable.length);
  const part = editable.slice(offset, offset + limit);
  const body = `${JSON.stringify(Object.fromEntries(part.map((entry) => [entry.key, entry.value])), null, 2)}\n`;
  const summary = `${counted(part.length, 'string')}${part.length < editable.length ? ` (${offset + 1} to ${offset + part.length} of ${editable.length})` : ''}; ${total - editable.length} others look like code, paths or ids and are left out`;
  if (flags.out) {
    writeFileSync(flags.out, body);
    console.log(`wrote ${flags.out}: ${summary}`);
    if (note) console.log(`note: ${note}`);
  } else {
    process.stdout.write(body);
    console.error(summary);
    if (note) console.error(`note: ${note}`);
  }
  return 0;
}

function runApply({ positional, flags }) {
  if (positional.length !== 2) throw new UsageError('apply needs <file> <edits.json>');
  const [file, editsPath] = positional;
  const { text: source, encoding } = readText(file);
  const format = stringsFormat(file, flags.format, source);
  if (format === 'prose') throw new UsageError(`apply works on ${STRING_FILES}`);
  const raw = readInput(editsPath);
  let edits;
  try {
    edits = JSON.parse(raw);
  } catch {
    throw new UsageError(`${editsPath} is not valid JSON`);
  }
  if (!edits || typeof edits !== 'object' || Array.isArray(edits)) throw new UsageError('the edits file must be a JSON object that maps key to new text');
  for (const [key, value] of Object.entries(edits)) if (typeof value !== 'string') throw new UsageError(`edit "${key}" must be a string`);
  const after = inFile(file, () => applyEdits(source, format, new Map(Object.entries(edits)), { column: flags.column }));
  const options = commonOptions(flags);
  const result = checkRewrite(source, after, { ...options, profile: options.profile === 'auto' ? 'ui' : options.profile, format, file, maxGrowth: undefined });
  if (flags.json) console.log(JSON.stringify(result, null, 2));
  else console.log(formatCheck(result, { before: file, after: `${file} + edits`, max: numberFlag(flags, 'max', 12) }));
  if (!flags.write) {
    console.log('Dry run. Add --write to save.');
    return result.ok ? 0 : 1;
  }
  if (!result.ok && !flags.force) {
    console.log(`Not written: ${counted(result.errors.length, 'error')}. Fix the edits, or pass --force.`);
    return 1;
  }
  writeFileSync(file, encodeText(after, encoding));
  console.log(`Wrote ${file}`);
  return 0;
}

function auditEntriesFor(source, format, column) {
  if (format === 'prose') {
    const entries = parseProse(source)
      .filter(isProse)
      .map((block) => ({ key: `line ${block.locate(0)}`, value: block.text }));
    return { entries, prose: true };
  }
  const { editable } = listStrings(source, format, { column });
  return { entries: editable.map(({ key, text }) => ({ key, value: text })), prose: false };
}

function runAudit({ positional, flags }) {
  if (positional.length !== 1) throw new UsageError('audit needs one file');
  const [file] = positional;
  const source = readInput(file);
  let format = pick(flags, 'format', FORMATS, 'auto');
  if (format === 'auto') {
    const structured = stringsFormat(file, 'auto', source);
    format = structured !== 'lines' ? structured : !MARKUP_DOCUMENT.test(file) && inferProfile(file, source) === 'ui' ? 'lines' : 'prose';
  }
  const { entries, prose } = inFile(file, () => auditEntriesFor(source, format, flags.column));
  const report = auditEntries(entries, { prose });
  if (flags.json) console.log(JSON.stringify(report, null, 2));
  else console.log(formatAudit(report, { file }));
  return 0;
}

function runPlan({ positional, flags }) {
  if (positional.length !== 1) throw new UsageError('plan needs one file');
  const [file] = positional;
  const options = commonOptions(flags);
  const plan = planDocument(readInput(file), {
    profile: options.profile,
    level: options.level,
    file: file === '-' ? undefined : file,
    chunkWords: numberFlag(flags, 'chunk', 1200, { min: 50 }),
    minWords: numberFlag(flags, 'min', 250, { min: 1 }),
  });
  if (flags.json) console.log(JSON.stringify(plan, null, 2));
  else console.log(formatPlan(plan, { file }));
  return 0;
}

const readable = (pattern) => pattern.replace(/\(\?:/g, '(').replace(/\[- \]/g, ' ');

function runWords({ flags }) {
  const plain = Object.entries(PLAIN_WORDS);
  const nouns = Object.entries(NOMINALIZATIONS);
  if (flags.json) {
    console.log(JSON.stringify({ plainWords: PLAIN_WORDS, wordyPhrases: WORDY_PHRASES, nominalizations: NOMINALIZATIONS, idioms: IDIOMS }, null, 2));
    return 0;
  }
  console.log('Plain words (heavy word → plain word)');
  for (const [from, to] of plain) console.log(`  ${from} → ${to}`);
  console.log('\nWordy phrases (phrase → shorter form)');
  for (const [from, to] of WORDY_PHRASES) console.log(`  ${readable(from)} → ${to}`);
  console.log('\nAction buried in a noun (make/take/give/perform + noun → verb)');
  for (const [from, to] of nouns) console.log(`  a ${from} → ${to}`);
  console.log('\nIdioms and business clichés (say the plain thing)');
  for (const idiom of IDIOMS) console.log(`  ${readable(idiom)}`);
  return 0;
}

function runRules({ flags }) {
  if (flags.json) {
    console.log(JSON.stringify(RULES.map(({ id, kind, weight, applies, strict, title }) => ({ id, kind, weight, applies, strict: Boolean(strict), title })), null, 2));
    return 0;
  }
  for (const rule of RULES) {
    console.log(`${rule.id.padEnd(24)} ${rule.kind.padEnd(8)} ${String(rule.weight).padEnd(5)} ${rule.applies.join(',')}${rule.strict ? ' (strict only)' : ''}  ${rule.title}`);
  }
  return 0;
}

function runProfiles({ flags }) {
  const profiles = Object.entries(PROFILES);
  if (flags.json) console.log(JSON.stringify(profiles.map(([name, profile]) => ({ name, label: profile.label })), null, 2));
  else for (const [name, profile] of profiles) console.log(`${name.padEnd(10)} ${profile.label}`);
  return 0;
}

const DEMO = new URL('../../references/demo/', import.meta.url);

// Runs the real tools on three bundled texts: a padded original, a plain rewrite and a copy of the
// rewrite with a number changed and a "not" dropped. The command fails if the check does not pass the
// rewrite or does not fail the copy, so the demo cannot show something the tool no longer does.
// How a person runs this program again from the current folder: "unslop" for the bin, "node <path>" for the script.
function programName() {
  const script = process.argv[1] ?? 'unslop';
  if (!script.endsWith('.mjs')) return basename(script);
  const near = relative(process.cwd(), script);
  return `node ${shellWord(near.length < script.length ? near : script)}`;
}

function runDemo({ flags }) {
  const read = (name) => readFileSync(new URL(name, DEMO), 'utf8').trimEnd();
  const [padded, plain, sabotaged] = ['padded.demo', 'plain.demo', 'sabotaged.demo'].map(read);
  const options = { profile: 'docs', file: 'rate-limits.md' };
  // The commands shown are real: paste them to get the same output.
  // A path that climbs out of the current folder to reach the demo reads better written in full.
  const near = relative(process.cwd(), fileURLToPath(DEMO));
  const folder = near.startsWith('..') ? fileURLToPath(DEMO).replace(/\/$/, '') : near;
  const path = (name) => `${name}.demo`;
  const inFolder = folder ? [`$ cd ${shellWord(folder)}`] : [];
  const program = `node ${shellWord(relative(fileURLToPath(DEMO), fileURLToPath(new URL('../../scripts/unslop.mjs', DEMO))))}`;
  const quote = (text) => text.split('\n').map((line) => `  | ${line}`).join('\n');
  const score = (report) => `slop ${report.scores.slop} per 1,000 words, ${report.scores.slopBand}`;
  const before = lintSource(padded, options);
  const after = lintSource(plain, options);
  const good = checkRewrite(padded, plain, options);
  const bad = checkRewrite(padded, sabotaged, options);
  const worked = good.ok && !bad.ok;
  if (flags.json) {
    console.log(JSON.stringify({ worked, slop: [before.scores.slop, after.scores.slop], rewrite: { ok: good.ok, errors: good.errors.length, warnings: good.warnings.length }, sabotaged: { ok: bad.ok, errors: bad.errors.map((e) => e.code) } }, null, 2));
    return worked ? 0 : 1;
  }
  const header = (label, text) => `${label}\n${quote(text)}`;
  console.log(
    [
      'A padded text, its plain rewrite, and a check that its facts held.',
      '',
      header(`BEFORE   ${score(before)}`, padded),
      '',
      header(`AFTER    ${score(after)}`, plain),
      '',
      ...inFolder,
      `$ ${program} check ${path('padded')} ${path('plain')} --profile docs`,
      formatCheck(good, { before: path('padded'), after: path('plain'), max: 6, program, gloss: true }),
      '',
      header('SABOTAGED  the same rewrite with one number changed and one "not" dropped', sabotaged),
      '',
      `$ ${program} check ${path('padded')} ${path('sabotaged')} --profile docs`,
      formatCheck(bad, { before: path('padded'), after: path('sabotaged'), max: 6, program, gloss: true }),
      '',
      'check reads numbers, names, code, links, negations, hedges and conditions. It cannot judge tone or meaning, so a person still reads the result.',
    ].join('\n'),
  );
  return worked ? 0 : 1;
}

const SCORING = ['profile', 'level', 'format', 'column', 'all-strings'];

// Each command with the options it takes. An option a command does not read is an error, not a no-op.
const COMMANDS = {
  lint: [runLint, [...SCORING, 'json', 'max', 'fail-above', 'summary', 'full']],
  check: [runCheck, [...SCORING, 'json', 'max', 'max-growth', 'strict']],
  claims: [runClaims, ['profile', 'json']],
  diff: [runDiff, ['profile', 'json']],
  voice: [runVoice, ['json']],
  begin: [runBegin, [...SCORING, 'json', 'name', 'force']],
  finish: [runFinish, [...SCORING, 'json', 'name', 'strict', 'max', 'allow-outside']],
  restore: [runRestore, ['json', 'name', 'allow-outside']],
  strings: [runStrings, ['format', 'column', 'all-strings', 'offset', 'limit', 'out']],
  apply: [runApply, [...SCORING, 'json', 'max', 'write', 'force']],
  audit: [runAudit, ['format', 'column', 'json']],
  plan: [runPlan, ['profile', 'level', 'json', 'chunk', 'min']],
  words: [runWords, ['json']],
  rules: [runRules, ['json']],
  profiles: [runProfiles, ['json']],
  demo: [runDemo, ['json']],
};

export const COMMAND_OPTIONS = Object.fromEntries(Object.entries(COMMANDS).map(([name, [, options]]) => [name, options]));

// These take no file, so a stray word after them is a mistake, such as `unslop demo extra`.
const TAKE_NO_ARGUMENTS = new Set(['words', 'rules', 'profiles', 'demo', 'finish']);

export const VERSION = '0.1.0';

const helpContext = () => ({ profiles: PROFILE_NAMES, levels: LEVEL_NAMES, options: COMMAND_OPTIONS });

export function main(argv) {
  const [command, ...rest] = argv;
  if (!command) {
    // Asking for help is not a failure: the agent that runs the script with no arguments reads the help and carries on.
    console.log(globalHelp(helpContext()));
    return 0;
  }
  if (command === '--version' || command === '-v') {
    console.log(VERSION);
    return 0;
  }
  if (command === 'help' || command === '--help' || command === '-h') {
    if (rest.length) throw new UsageError('help takes no arguments');
    console.log(globalHelp(helpContext()));
    return 0;
  }
  const entry = COMMANDS[command];
  if (!entry) throw new UsageError(`unknown command "${command}". Try: ${Object.keys(COMMANDS).join(', ')}`);
  if (rest.includes('--help') || rest.includes('-h')) {
    console.log(commandHelp(command, helpContext()));
    return 0;
  }
  const [handler, options] = entry;
  const args = parseArgs(rest, { known: options, command });
  if (args.positional.filter((word) => word === '-').length > 1) throw new UsageError(`${command} cannot read stdin twice. Save one of the texts to a file and give "-" for the other`);
  if (TAKE_NO_ARGUMENTS.has(command) && args.positional.length) throw new UsageError(`${command} takes no arguments, but got "${args.positional[0]}"`);
  return handler(args);
}

export function exitCodeFor(error) {
  if (error instanceof UsageError || error instanceof SnapshotError) return { code: 2, message: error.message };
  if (error?.code === 'ENOENT') return { code: 2, message: `no such file: ${error.path}` };
  if (typeof error?.code === 'string' && error.syscall) return { code: 2, message: error.message };
  return null;
}
